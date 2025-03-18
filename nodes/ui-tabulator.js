module.exports = function (RED) {
	//console.log("Current directory:", __dirname);
	const {parseFuncSheet,testImport} = require(__dirname+'/common.js');
	//testImport();
	
    function UITabulatorNode (config) {
        RED.nodes.createNode(this, config)

        const node = this;

		// Set debug log policy
		const e = process.env.TBDEBUG;
		const printToLog  = (e?.toLowerCase() === 'true') ? true : false;
		config.printToLog = printToLog;

		debugLog("Creating ui-tabulator server node, id="+node.id);

		node.multiUser = config.multiUser;
		// create maps for incoming msg id's, to allow duplicate of messages (from concurrent open clients)
		if (!node.multiUser)
		{
			node.lastMsgs		= new Map();	// response messages from the widget, going to the node output
			node.lastClientMsgs	= new Map();	// internal client update notifications 
		}
		
        // which group are we rendering this widget
        const group = RED.nodes.getNode(config.group);
        const base = group.getBase();

		// *************************************************
        // server-side msg listeners
		// *************************************************
        const evts = {
            onAction: true,
			 
			//-------------------------------------------------------------------------
			// input message coming from the server node input port
			// note: Node-red automatically sends every input message to the dashboard.
			// if it's a server-node command, the table widget will know to ignore it
			//-------------------------------------------------------------------------
            onInput: function (msg, send, done) {
				debugLog('onInput: '+node.id,msg);
				
				let dsImage = null;
				const conns = base.uiShared?.connections;
				const connCount = (typeof conns === "object" && conns != null) ? Object.keys(conns).length : 0;
				
				// server-node commands
				//---------------------
				switch (msg.tbCmd)
				{
					case "tbShowDatastore":
						dsImage = base.stores.data.get(node.id);
						if (!msg.tbOutput || msg.tbOutput?.toLowerCase() === "log")
							console.log("Datastore image for node "+node.id+":",dsImage);
						if (!msg.tbOutput || msg.tbOutput?.toLowerCase() === "msg")
							node.send({payload:dsImage});
						return;
					case "tbGetDsData":
						dsImage = base.stores.data.get(node.id);
						node.send({payload:dsImage.data || "No Data"});
						return;
					case "tbGetDsDataCount":
						dsImage = base.stores.data.get(node.id);
						node.send({payload:dsImage?.data?.length});
						return;
					case "tbGetClientCount":
						msg.payload = connCount;
						node.send(msg);
						return;
				}
				// if msg was not a server-node command, but there are no connected clients to receive it, send a warning
				if (connCount === 0)
				{
					const errMsg = "No connected clients - message to ui-tabulator will be ignored";
					debugLog(errMsg);
					if (!msg.tbDoNotReply)
					{
						msg.error = errMsg;
						node.send(msg);
					}
				}
            },
			//-------------------------------------------------------------------------
			// messages sent  from the dashboard widget to a named server-node listener
			// handler function arguments: conn = socketId, id = node.id, msg
			//-------------------------------------------------------------------------
            onSocket: {

				//-------------------------------------------------------------------------------------------------
				//'widget-action': function  (conn, id, msg) {
					// the standard msg handler.
					// here it is commented-out, hence messages sent to 'widget-action' are automatically forwarded as-is to output.
					//console.log("widget-action msg:",msg);
                //},

				// **********************************************************************************************************************************
				// custom listeners for widget responses to commands.
				// in shared mode, identical messages (from concurrent open clients) are being de-duplicated by msg Id, and only one msg is processed
				// **********************************************************************************************************************************
                
				//['tbSendMessage'+node.id]: function (conn, id, msg) {		// listener per ui-tabulator node instance
                'tbSendMessage': function (conn, id, msg) {					// single listener for all ui-tabulator instances (less impact on socket)
					if (id !== node.id) 					
						return;
										
					// Reponses to commands
					//---------------------
					switch (msg.tbCmd)
					{
						// Connection Test
						case "tbTestConnection":
							console.log("ui-tabulator connection test: ping from node="+msg.nodeId+", sockId="+msg.clientSockId+", on listener "+msg.listener);
							node.send(msg);
							return;
						default: 
							//console.log("command response:",msg)
							if (node.multiUser || !inMap(node.lastMsgs,msg._msgid, msg._client || ""))
								node.send(msg);
							return;
					}
                },
				// Internal client-server update commands
				//---------------------------------------
                //['tbClientCommands'+node.id]: function (conn, id, msg) {	// listener per ui-tabulator node instance
                'tbClientCommands': function (conn, id, msg) {				// single listener for all ui-tabulator instances (less impact on socket) 
					if (id !== node.id)
						return;

					//console.log("internal client command",msg)
					switch (msg.tbClientCmd)
					{
						// Notification from a table (sent only when in shared mode) about an in-cell user edit.
						// Since this is a user-originated change (received from a single client), it needs to be distributed to all other clients
						//---------------------------------------------------------------------
						case 'tbCellEditSync':
							debugLog("Received 'cellEdited' notification");
							// Update datastore
							debugLog("Saving to datastore: node.id="+node.id,msg);
							const existingImage = base.stores.data.get(node.id);
							existingImage.timestamp   = msg.payload.timestamp;
							existingImage.clientMsgId = msg.notificationId;
							const row = existingImage.data.find(element => element[msg.payload.idField] == msg.payload.rowId)
							if (row)
								row[msg.payload.field] = msg.payload.value;
							else
								console.error("Datastore cellEditSync error - row "+msg.payload.rowId+" not found")
							
							base.stores.data.clear(node.id);
							base.stores.data.save(base, node, existingImage);

							// update the other client widgets
							debugLog("Sending to other clients");
							msg.tbCmd = "tbCellEditSync";
							delete msg.topic; // remove 'tbNotification' to avoid confusion
							msg.tbClientScope = "tbNotSameClient";	// skip originator, update only the other clients
							broadcastToClients(msg);
							break;

						// save to datastore (sent in shared mode only)
						//---------------------------------------------------------------------
						case 'tbSaveToDatastore':
							if (!node.multiUser && !inMap(node.lastClientMsgs,msg.clientMsgId,""))
							{
								const dsImage = msg.payload;
								debugLog(`Saving to datastore: node.id=${node.id}, clientMsgId: ${dsImage.clientMsgId}`);
								debugLog(dsImage);
								
								if (!dsImage.hasOwnProperty("config") || !dsImage.hasOwnProperty("funcs") || !dsImage.hasOwnProperty("data") || !dsImage.hasOwnProperty("styleMap"))
								{
									// when dsImage has only selective fields, retrieve & update the existing image
									const existingImage = base.stores.data.get(node.id);
									if (!dsImage.hasOwnProperty("config"))
										dsImage.config = existingImage.config;
									if (!dsImage.hasOwnProperty("funcs"))
										dsImage.funcs = existingImage.funcs;
									if (!dsImage.hasOwnProperty("data"))
										dsImage.data = existingImage.data;
									if (!dsImage.hasOwnProperty("styleMap"))
										dsImage.styleMap = existingImage.styleMap;
								}
								base.stores.data.clear(node.id);
								base.stores.data.save(base, node, dsImage);
							}
							break;

						// Test client/server-node connectivity
						//---------------------------------------------------------------------
						case 'tbTestConnection':
							console.log("ui-tabulator connection test: ping from node="+msg.nodeId+", sockId="+msg.clientSockId+", on listener "+msg.listener);
							node.send(msg);
							break;
					}
				}
            }
        }
		//--------------------------------------------------------
		//Initialize Datastore
		//--------------------------------------------------------
		base.stores.data.clear(node.id);
		if (node.multiUser)
			// for backwards compatibility with older dashboard versions - sets a dummy object in the data store to ensure 'widget-load' notification
			base.stores.data.save(base, node, {ds:"<Empty>"});
		else
		{
			const dsImage = {
				timestamp:Date.now(),
				clientMsgId:"",
				config:null,
				funcs:null,
				data:null,
				styleMap: null
			}

			if (config.initObj?.trim())
			{
				try  {
					const initObj = JSON.parse(config.initObj);
					// successful parsing
					if (Object.keys(initObj).length > 0)
					{
						if (initObj.data)
						{
							dsImage.data = initObj.data;
							delete initObj.data;
						}
						else
							dsImage.data = [];
						dsImage.config = initObj;
					}
				} catch (err) {
					console.error("Invalid table configuration: ",err);
				}
			}
			dsImage.funcs = parseFuncSheet(config.funcs);  // parsing func taken from 'common' import

			//console.log("initial DS Image",dsImage);
			base.stores.data.save(base, node, dsImage);
		}

		//--------------------------------------------------------
		// inform the dashboard UI that we are adding this node
		//--------------------------------------------------------
        if (group) {
            group.register(node, config, evts);
        } else {
            node.error('No group configured');
        }
		//--------------------------------------------------------
		// read theme CSS file, if configured
		//--------------------------------------------------------
		config.themeCSS = "";
		let filename = config.themeFile?.trim();
		if (filename)
		{
			const urlRegex = new RegExp('^@URL:','i');
			if (urlRegex.test(filename))  // deprecated: fetch from URL
				console.error("Fetching CSS file from a URL is now deprecated");
			else
			{
				const fs = require('fs');
				const cssPrefix = "@CSS:";
				const cssRegex = new RegExp('^'+cssPrefix,'i');
				if (cssRegex.test(filename))	// take from tabulator CSS directory
				{
					// __dirname = location of this file = <NR home dir>/node_modules/@omrid01/node-red-dashboard-2-table-tabulator/nodes
					// Tabulator CSS dir = <NR home dir>/node_modules/tabulator-tables/dist/css
					
					const cssDir =  __dirname + "/../../../tabulator-tables/dist/css/";
					filename = cssDir + filename.slice(cssPrefix.length);
				}
				try	{
					config.themeCSS = fs.readFileSync(filename,"utf8");
					console.log("ui-tabulator: CSS file read successfully, length=",config.themeCSS.length);
				}
				catch (err)	{
					console.error("Cannot read CSS file: ",err);
				}
			}
		}

		//^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
		// Temp workaround - forcing browser 'reload' command to all clients due to NR socket bug
		//^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
		setTimeout(()=>{
			debugLog("Sending reload command to clients");
			broadcastToClients({tbCmd:"tbReloadClient"});
		}, 2000);
		//^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
		//----------------------------------------------------------------------------
		function broadcastToClients(msg)
		{
			debugLog(""+node.id+": broadcasting:",msg);
			base.emit('tbServerEvent:'+node.id, msg, node);
		}
		//----------------------------------------------------------------------------
		function debugLog(t1,t2,t3,t4)
		{
			if (printToLog)
				console.log("ui-tabulator:",t1, t2||"", t3||"", t4||"");
		}
		//----------------------------------------------------------------------------
	}
    RED.nodes.registerType('ui-tabulator', UITabulatorNode)
}
//---------------------------------------------------------------------------------
function inMap(map,key,val)
{
	const maxMapSize = 10;

	if (!key)
		return false;

	if (map.has(key))
		return true;

	map.set(key, val);
	//let txt = `inserted to map: key=${key},val=${val}, `;
	
	if (map.size > maxMapSize)
	{
		const firstElement = map.entries().next().value;
		map.delete(firstElement[0]);
		//txt = txt.replace('inserted to','replaced in');
	}
	//console.log("map=",map);
	//console.log(txt+'current map size='+map.size);
	return false;
}
