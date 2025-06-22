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
		// create maps for incoming msg id's, to allow de-duplication of identical messages (from concurrent open clients)
		if (!node.multiUser)
			node.lastMsgs = new Map();
		
        // which group are we rendering this widget
        const group = RED.nodes.getNode(config.group);
        const base = group.getBase();

		// *************************************************
        // server-side msg listeners
		// *************************************************
        const evts = {
			//--------------------------------------------------------------------------------
			// messages coming from the server node input port
			// note: Node-red automatically sends every input message to the dashboard clients.
			// if it's a server-node command, the table widget will know to ignore it
			//---------------------------------------------------------------------------------
            onInput: function (msg, send, done) {
				debugLog('onInput: '+node.id,msg);
				
				let tblImage = null;
				const conns = base.uiShared?.connections;
				const connCount = (typeof conns === "object" && conns != null) ? Object.keys(conns).length : 0;
				
				// server-node commands
				//---------------------
				switch (msg.tbCmd)
				{
					case "tbShowDatastore":
						const dsImage = msg.showAll ? base.stores.data.get(node.id) : base.stores.data.get(node.id).tblImage; // undocumented 'showAll' prop, to show the full DS image
						if (!msg.tbOutput || msg.tbOutput?.toLowerCase() === "log")
							console.log("Datastore image for node "+node.id+":",dsImage);
						if (!msg.tbOutput || msg.tbOutput?.toLowerCase() === "msg")
						{
							msg.payload = dsImage;
							node.send(msg);
						}
						return;
					case "tbGetDsData":
						tblImage = base.stores.data.get(node.id).tblImage;
						msg.payload = tblImage?.data || undefined;
						node.send(msg);
						return;
					case "tbGetDsDataCount":
						tblImage = base.stores.data.get(node.id).tblImage;
						msg.payload = tblImage?.data?.length;
						node.send(msg);
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
			//---------------------------------------------------------------------------------------------------------------------
			// Handler for messages sent from the dashboard widget, replacing the default handler (by setting onAction=false, above)
			// the message can be tweaked if needed, before sending. it can also be discarded, by omitting the send()
			// function arguments: conn = socketId, id = node.id, msg
			//----------------------------------------------------------------------------------------------------------------------
            // onAction: true, // --> invokes the default 'widget-action' handler, which overrides 'msg.topic'
			onAction: false,
			onSocket: {
				'widget-action': function  (conn, id, msg) {	// we don't use 'widget-send', as it writes the last msg into the datastore, which we don't want
					if (id !== node.id) 					
						return;
					debugLog("Received widget-action msg:",msg);

					// *****************************************************************
					// widget-originated messages (event notifications & client commands)
					// *****************************************************************
					if (msg.msgType === "tbNotification")
					{
						switch (msg.event)
						{
							case "tbCellEditedSync":
								debugLog("Received 'cellEditedSync' notification");
								// Update datastore
								const tblImage = base.stores.data.get(node.id).tblImage;
								if (!(tblImage?.data))
								{
									console.error("Datastore cellEditSync error - invalid table image");
									return;
								}
								tblImage.timestamp = Date.now();
								const row = tblImage.data.find(element => element[msg.payload.idField] == msg.payload.rowId)
								if (row)
									row[msg.payload.field] = msg.payload.value;
								else
								{
									console.error("Datastore cellEditSync error - row "+msg.payload.rowId+" not found")
									return;
								}
								base.stores.data.clear(node.id);
								base.stores.data.save(base, node, {tblImage:tblImage});

								// update the other client widgets
								debugLog("Sending to other clients");
								msg.tbCmd = "tbCellEditSync";
								msg.tbClientScope = "tbNotSameClient";	// skip originator, update only the other clients
								broadcastToClients(msg);
								return;
							default:
								node.send(msg);
						}
						return;
					}
					// ***********************
					// Response Messages
					// ***********************
					debugLog("Incoming respone msg:",msg);
					switch (msg.tbCmd)
					{
						// Connection Test
						case "tbTestConnection":
							console.log("ui-tabulator connection test: ping from node="+msg.nodeId+", sockId="+msg.clientSockId+", on listener 'widget-action'");
							node.send(msg);
							return;
						default: 
							debugLog("Received command response:",msg);
							if (node.multiUser)
							{
								if (!msg.tbDoNotReply)
									node.send(msg);
								return;
							}
							if (inMap(node.lastMsgs,msg._msgid, msg._client || ""))
								return; // discard duplicate message from concurrent clients

							if (msg.hasOwnProperty("dsImage"))
							{
								//saveToDatastore(config,funcs,data,styleMap,clientMsgId)
								debugLog("Saving to datastore: node.id="+node.id," image=",msg.dsImage);
								const newImage = msg.dsImage;
								newImage.timestamp = Date.now();
								
								if (!newImage.hasOwnProperty("config") || !newImage.hasOwnProperty("funcs") || !newImage.hasOwnProperty("data") || !newImage.hasOwnProperty("styleMap"))
								{
									// when newImage has only partial info, retrieve the existing image and merge it
									const existingImage = base.stores.data.get(node.id).tblImage;
									if (!newImage.hasOwnProperty("config"))
										newImage.config = existingImage.config;
									if (!newImage.hasOwnProperty("funcs"))
										newImage.funcs = existingImage.funcs;
									if (!newImage.hasOwnProperty("data"))
										newImage.data = existingImage.data;
									if (!newImage.hasOwnProperty("styleMap"))
										newImage.styleMap = existingImage.styleMap;
								}
								base.stores.data.clear(node.id);
								base.stores.data.save(base, node, {tblImage:newImage});
								delete msg.dsImage;
							}
							if (!msg.tbDoNotReply)
								node.send(msg);
							return;
					}
				}
            }
        }
		//--------------------------------------------------------
		//Initialize Datastore
		//--------------------------------------------------------
		base.stores.data.clear(node.id);
		if (node.multiUser)
			base.stores.data.save(base, node, {tblImage:null});
		else
		{
			const tblImage = {
				timestamp:Date.now(),
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
							tblImage.data = initObj.data;
							delete initObj.data;
						}
						else
							tblImage.data = [];
						tblImage.config = initObj;
					}
				} catch (err) {
					console.error("Invalid table configuration: ",err);
				}
			}
			tblImage.funcs = parseFuncSheet(config.funcs);  // parsing func taken from 'common' import

			//console.log("initial DS Image",tblImage);
			base.stores.data.save(base, node, {tblImage:tblImage});
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
		}, 200);
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
		const firstKey = map.keys().next().value;
		map.delete(firstKey);
		//txt = txt.replace('inserted to','replaced in');
	}
	//console.log("map=",map);
	//console.log(txt+'current map size='+map.size);
	return false;
}
