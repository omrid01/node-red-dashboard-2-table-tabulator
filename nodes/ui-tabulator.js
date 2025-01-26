module.exports = function (RED) {
	const fs = require('fs');

    function UITabulatorNode (config) {
        RED.nodes.createNode(this, config)

        const node = this;
		const dsDummyImage = {ds:"Dummy"};

		// Set debug log policy
		const e = process.env.TBDEBUG;
		const printToLog  = (e?.toLowerCase() === 'true') ? true : false;
		config.printToLog = printToLog;

		debugLog("Creating ui-tabulator server node, id="+node.id);

		// Saving last msg id's to allow filtering duplicate messages (from concurrent open clients)
		node.multiUser = config.multiUser;
		if (!node.multiUser)
		{
			node.lastMsgs		= new Map();
			node.lastClientMsgs	= new Map();
		}
		
        // which group are we rendering this widget
        const group = RED.nodes.getNode(config.group);
        const base = group.getBase();

        // server-side event handlers
        const evts = {
            onAction: true,
            onInput: function (msg, send, done) {  // the *input* message coming into the server node input port
				debugLog('onInput: '+node.id,msg);

				// check if there are connected clients
				const conns = base.uiShared?.connections;
				const connCount = typeof conns === "object" && conns != null ? Object.keys(conns).length : 0;
				if (msg.tbCmd === "tbGetClientCount")
				{
					msg.payload = connCount;
					node.send(msg);
				}
				else if (connCount === 0)
				{
					const errMsg = "No connected clients - message to ui-tabulator ignored";
					debugLog(errMsg);
					if (!msg.tbDoNotReply)
					{
						msg.error = errMsg;
						node.send(msg);
					}
				}

                // forward it as-is to any connected nodes in Node-RED  - ** deprecated  feature **
                //if (config.passthru)
				//	send(msg);
            },

            onSocket: {	// Function arguments: conn = socketId, id = node.id
				//-------------------------------------------------------------------------------------------------
				//'widget-action': function  (conn, id, msg) {
				//	if (id === node.id && msg.topic === "tbNotification")
				//		console.log("'widget action' msg:",msg)
                //},

				// *******************************************************************************************************************************
				// Generic response sender. filters duplicate messages (from multiple open clients, in shared mode), and sends through output port
				// *******************************************************************************************************************************
                
				//['tbSendMessage'+node.id]: function (conn, id, msg) { // listener per ui-tabulator node instance
                'tbSendMessage': function (conn, id, msg) {
					if (id !== node.id) // single listener for all ui-tabulator nodes (less impact on socket)
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
							//console.log("command response",msg)
							if (node.multiUser || !inMap(node.lastMsgs,msg._msgid, msg._client || ""))
								node.send(msg);
							return;
					}
                },

				// *******************************************************************************************************************************
				// Internal commands from the clients
				// *******************************************************************************************************************************

                //['tbClientCommands'+node.id]: function (conn, id, msg) {	// listener per ui-tabulator node instance
                'tbClientCommands': function (conn, id, msg) {				// single listener for all ui-tabulator nodes (less impact on socket) 
					if (id !== node.id)
						return;

					//console.log("internal client command",msg)
					switch (msg.tbClientCmd)
					{
						// Notification from a table (when in shared mode) about an in-cell user edit.
						// Since this is a user-originated change (on a single client), it needs to be distributed to all other clients
						//---------------------------------------------------------------------
						case 'tbCellEditSync':
							debugLog("Received 'cellEdited' notification");

							// Update datastore
							if (!node.multiUser)
							{
								debugLog("Saving to datastore: node.id="+node.id,msg);
								base.stores.data.clear(node.id);
								base.stores.data.save(base, node, msg.dsImage);
							}

							// update the other client widgets
							debugLog("Sending to other clients");
							delete msg.dsImage;
							delete msg.topic; // remove 'tbNotification' to avoid confusion
							msg.tbClientScope = "tbNotSameClient";	// skip originator, update only the other clients
							broadcastToClients(msg);
							break;

						// Datastore commands
						//---------------------------------------------------------------------
						case 'tbSaveToDatastore':
							if (!node.multiUser && !inMap(node.lastClientMsgs,msg.clientMsgId,""))
							{
								const dsImage = msg.payload;
								debugLog(`Saving to datastore: node.id=${node.id}, clientMsgId: ${dsImage.clientMsgId}`);
								debugLog("exists:",dsImage.exists);
								debugLog("config:", dsImage.config);
								debugLog("data:", dsImage.data ? dsImage.data.length+' rows' : null);

								base.stores.data.clear(node.id);
								base.stores.data.save(base, node, dsImage);
							}
							break;
						case 'tbShowDatastore':		// for testing
							if (!node.multiUser && !inMap(node.lastClientMsgs,msg.clientMsgId,""))
							{
								let data = base.stores.data.get(id) || "<none>";
								console.log("Datastore image for node "+node.id+":",data);
								if (msg.sendMsg)
									node.send({payload:data});
							}
							break;
						case 'tbClearDatastore':
							if (!node.multiUser && !inMap(node.lastClientMsgs,msg.clientMsgId,""))
							{
								debugLog("Setting dummy to datastore: node.id="+node.id);
								base.stores.data.clear(node.id);
								base.stores.data.save(base, node, dsDummyImage);
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

		// Set a "dummy" object in the data store to ensure 'widget-load' notification (update: NR bug has been fixed, will discard this in the future)
		if (!node.multiUser)
			base.stores.data.save(base, node, dsDummyImage);

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
		let themeFile = config.themeFile.trim();
		if (themeFile)
		{
			const urlPrefix = "@URL:";
			const cssPrefix = "@CSS:"
			if (themeFile.match(new RegExp('^@URL:','i')) !== null)  // URL
			{
				const fileURL = themeFile.slice(urlPrefix.length);
				debugLog("Fetching file from URL",fileURL);
				let fetchOK = false;
				fetch(fileURL)
					.then((response) => {
						if (response.ok)
							fetchOK = true;
						return response.text()
					})
					.then(text => {
						if (fetchOK)
						{
							config.themeCSS = text;
							console.log("ui-tabulator: CSS file fetched successfully, length=",data.length);
						}
						else
							console.error("Error fetching CSS file:",text);
					})
					.catch(err => {
						console.error('Error fetching CSS file:', err);
					});
			}
			else	// File
			{
				try	{
					if (themeFile.match(new RegExp('^@CSS:','i')) !== null)  // take CSS file from Tabulator dist
					{
						// __dirname = location of this (executing) file , in this case = C:\Node-red\Dsh2\node-red-ui-tabulator\nodes
						// Tabulator CSS files are in C:/Node-red/Dsh2/node-red-ui-tabulator/node_modules/tabulator-tables/dist/css/
						// For example: tabulator_midnight.min.css, tabulator_modern.min.css etc.
						
						// check in internal directory
						let cssDir =  __dirname + "/../node_modules/tabulator-tables/dist/css/";
						if (fs.existsSync(cssDir))
						{
							debugLog("Found local CSS directory "+cssDir);
							themeFile = cssDir + themeFile.slice(cssPrefix.length);
						}
						else
						{
							// check in Node-red packages
							cssDir =  __dirname + "/../../../tabulator-tables/dist/css/";
							if (fs.existsSync(cssDir))
							{
								debugLog("Found CSS directory in Node-red node-modules");
								themeFile = cssDir + themeFile.slice(cssPrefix.length);
							}
							else
								console.error("Cannot find CSS directory");
						}
					}
					// else use file name as-is

					debugLog("Reading CSS file", themeFile);
					let data = fs.readFileSync(themeFile,"utf8");
					config.themeCSS = data;
					console.log("ui-tabulator: CSS file read successfully, length=",data.length);
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
		//--------------------------------------------------------
		function broadcastToClients(msg)
		{
			debugLog(""+node.id+": broadcasting:",msg);
			base.emit('tbServerEvent:'+node.id, msg, node);
		}
		function debugLog(t1,t2,t3,t4)
		{
			if (printToLog)
				console.log("ui-tabulator:",t1, t2||"", t3||"", t4||"");
		}
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