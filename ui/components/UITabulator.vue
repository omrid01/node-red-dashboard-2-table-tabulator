<template>
    <!-- Component must be wrapped in a block so props such as className and style can be passed in from parent    -->
    <div className="ui-tabulator-wrapper">
		<div ref="tabulatorDiv"></div>
    </div>
 </template>

<script>
import {TabulatorFull as Tabulator} from 'tabulator-tables';
import { markRaw } from 'vue'
import { mapState } from 'vuex'

export default {
    name: 'UITabulator',
    inject: ['$socket'],
    props: {
        /* do not remove entries from this - Dashboard's Layout Manager's will pass this data to your component */
        id: { type: String, required: true },
        props: { type: Object, default: () => ({}) },
        state: { type: Object, default: () => ({ enabled: false, visible: false }) }
    },
    setup (props) {
        console.info('UITabulator setup with:', props)
        console.debug('Vue function loaded correctly', markRaw)
    },
    computed: {
        ...mapState('data', ['messages'])
    },
// ******************************************************************************************************************************************
    data () {
        return {
            vuetifyStyles: [
                { label: 'Responsive Displays', url: 'https://vuetifyjs.com/en/styles/display/#display' },
                { label: 'Flex', url: 'https://vuetifyjs.com/en/styles/flex/' },
                { label: 'Spacing', url: 'https://vuetifyjs.com/en/styles/spacing/#how-it-works' },
                { label: 'Text & Typography', url: 'https://vuetifyjs.com/en/styles/text-and-typography/#typography' }
            ],
			// Table properties
			tbl: 		 	null,	// reference to table object
			tblReady:	 	false,	// Indicates that table has completed initializing
			tblDivId:		"",		// Optional, allow table instantiation on a specified Div
			rowIdField:		"id",	// The name of the field which holds the unique row Id (the default is 'id', but can be overridden)

			origTblConfig:	null,	// original table configuration, as configured in the node (converted from JSON to an object). null=no tbl config in node
			origTblFuncs:	null,	// the custom functions configured in the node (converted from JSON to an object). null=no functions

			activeTblConfig:null,	// active table configuration (excluding data & funcs). null=no active table
			activeTblFuncs:	null,	// active funcs (custom formatters). null = none
			tblStyleMap:	null 	// styles assigned to the active table (via the tbSetStyle command)
		}
    },
// ******************************************************************************************************************************************
    mounted () {
		const $widgetScope = this; // Save the 'this' scope for socket listener, callbacks, external functions etc.
		
		window.tbPrintToLog = this.props.printToLog;
		debugLog(`***ui-tabulator node ${this.id} mounted on client ${this.$socket.id}, debug=${window.tbPrintToLog?"on":"off"}`);

		// parse the original table configuration & funcs (from node configuration)
		const cfgStr = this.props.initObj?.trim();
		if (cfgStr)
		{
			let cfg = null;
			try  {
				cfg = JSON.parse(cfgStr);
			}
			catch (err) {
				cfg = null;
				console.error(this.id+": Invalid table configuration:",err);
			}
			if (cfg)
			{
				this.origTblConfig = cfg;
				this.origTblFuncs  = parseFuncSheet(this.props.funcs);
			}
		}
		
		// Load CSS theme
		if (this.props.themeCSS)
			loadThemeCSS(this.props.themeCSS,this);

		if (this.props.tblDivId);
		{
			this.tblDivId = this.props.tblDivId?.trim() || "";
//			this.$refs.tabulatorDiv.style.display = "none";  // hide the original DIV
		}

		// Set max table width (else will overflow with no horizontal scroller
		const maxWidth = this.props.maxWidth?.trim();
		if (maxWidth && !this.tblDivId)
			this.$refs.tabulatorDiv.style.width = maxWidth;

        // tell Node-RED that we're loading a new instance of this widget
        this.$socket.emit('widget-load', this.id)
		
		// ****************************************************************************************
		// listener for flow messages on input port
		// ****************************************************************************************
        this.$socket.on('msg-input:' + this.id, (msg) => {
			if (!msg || !acceptMsg(msg,$widgetScope))
				return;
			processMsg(msg,$widgetScope);
		});
		
		// ****************************************************************************************
		// Utility listener for custom server node notifications
		// ****************************************************************************************
		this.$socket.on('tbServerEvent:' + this.id, (msg) => {

			//^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
			// Temp workaround - forcing client reload (due to NR framework bug)
			//-----------------------------------------------------------------
			if (msg.tbCmd === "tbReloadClient")
			{
				console.log($widgetScope.id+": Received reload request");

				// setTimeout(()=>location.reload(),5000);
				location.reload();
				return;
			}
			//^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

			if (!msg || !acceptMsg(msg,$widgetScope))
				return;
			processMsg(msg,$widgetScope);
		});
		
		// ***************************************************************************************************
		// msg listener for 'widget-load' event, sent from server when widget is loaded (with datastore image)
		// ***************************************************************************************************
		this.$socket.on('widget-load:' + this.id, (msg) => {
			initialTableLoad(msg,this)
        })
    },
// ******************************************************************************************************************************************
    unmounted () {
		destroyTable(this);

        /* Make sure, any events you subscribe to on SocketIO are unsubscribed to here */
        this.$socket?.off('widget-load:' + this.id)
        this.$socket?.off('msg-input:' + this.id)
		this.$socket?.off('tbServerEvent:' + this.id)
    },
// ******************************************************************************************************************************************
    methods: {
        //  widget-action just sends a msg to Node-RED, it does not store the msg state server-side
        //  alternatively, you can use widget-change, which will also store the msg in the Node's datastore
		sendNotification(msg) {
			this.$socket.emit('widget-action', this.id, msg) // Using the "standard" send for notifications
        },
		send(msg) {
			// Instead of emitting to 'widget-action', we send the message as a custom event to the server, allowing the server to de-duplicate responses from concurrent clients (in shared mode)
			if (!msg.tbDoNotReply)
				this.$socket.emit('tbSendMessage'/*+this.id*/, this.id, msg)
        },
		sendClientCommand(cmd,msg) {
            msg.tbClientCmd = cmd;
            this.$socket.emit('tbClientCommands'/*+this.id*/, this.id, msg)
        },
		saveToDatastore(config,funcs,data,styleMap,clientMsgId)	{
			let dsMsg = {};
            dsMsg.tbClientCmd = 'tbSaveToDatastore';
			dsMsg.clientMsgId = clientMsgId;
			dsMsg.payload = {
				timestamp: Date.now(),
				clientMsgId: clientMsgId,
				config: config,
				funcs: funcs,
				data:   data,
				styleMap: styleMap
			}
            this.$socket.emit('tbClientCommands'/*+this.id*/, this.id, dsMsg)
 		},
		clearDatastore(clientMsgId)
		{
			let dsMsg = {};
            dsMsg.tbClientCmd = 'tbClearDatastore';
			dsMsg.clientMsgId = clientMsgId;
            this.$socket.emit('tbClientCommands'/*+this.id*/, this.id, dsMsg)
		},
		showDatastore(sendMsg,clientMsgId)
		{
			let dsMsg = {};
            dsMsg.tbClientCmd = 'tbShowDatastore';
			dsMsg.clientMsgId = clientMsgId;
			dsMsg.sendMsg = sendMsg;
            this.$socket.emit('tbClientCommands'/*+this.id*/, this.id, dsMsg)
		}
	}
}
// ******************************************************************************************************************************************
// My functions
// ******************************************************************************************************************************************
// Determine if the client should accept the incoming message
function acceptMsg(msg,$widgetScope)
{
	 // Special utility msg for testing client/server connections. bypasses all scope constraints
	if (msg.tbCmd === "tbTestConnection")
		return true;

	// Ignore commands which are meant for the server-side node only.
	switch (msg.tbCmd)
	{
		case "tbGetClientCount":
			return false;
	}

	let msgClientId = msg?._client?.socketId || "";  // get client Id

	// Check if msg includes an explicitly-specified client scope
	if (msg.hasOwnProperty("tbClientScope"))
	{
		switch (msg.tbClientScope)
		{
			case "tbAllClients":
				return true;
			case "tbSameClient":
				return (msgClientId && msgClientId === $widgetScope.$socket.id);
			case "tbNotSameClient":
				return (msgClientId !== $widgetScope.$socket.id);
			case "tbNone":
			default:
				return false;
		}
	}
	
	// Always accept msg if not from a specific client
	if (!msgClientId)
		return true;
		
	// When msg from specific client, accept per shared/multiUser mode
	if ($widgetScope.props.multiUser)  // in multi-user, accept only from own client
		return (msgClientId === $widgetScope.$socket.id);
	else
	{
		// in shared mode, accept data-changing messages even if originated by other clients
		const changeMsgs = [
			"tbCreateTable", "tbResetTable", "tbDestroyTable", "destroy",
			"tbSetStyle", "tbClearStyles",
			"addRow", "updateRow", "updateOrAddRow", "deleteRow",
			"addData", "setData", "replaceData", "updateData", "updateOrAddData", "clearData"
		];
		if (changeMsgs.includes(msg.tbCmd))
			return true;
		else
			return (msgClientId === $widgetScope.$socket.id);
	}
}
// ********************************************************************************************************************
function processMsg(msg,$widgetScope)
{
	delete msg.error;
	const cmd = msg.tbCmd;
	
	//------------------------------------------------------------------
	// Node commands
	//------------------------------------------------------------------
	switch (cmd)
	{
		case "tbCreateTable":
			debugLog($widgetScope.id+": creating table from msg");
			if (!msg.tbInitObj)
			{
				msg.error = "Invalid table configuration";
				$widgetScope.send(msg);
				return;
			}
			if (!$widgetScope.props.allowMsgFuncs && (!!msg.tbFuncs || hasInlineFuncs(msg.tbInitObj)))
			{
				msg.error = "Messages containing function definitions are blocked in the node configuration";
				$widgetScope.send(msg);
				return;
			}
			
			const funcs = parseFuncSheet(msg.tbFuncs);
			createTable(msg.tbInitObj,funcs,$widgetScope)
			    .then(result => { 
					if (!$widgetScope.props.multiUser)
					{
						const data = msg.tbInitObj.data || [];
						$widgetScope.saveToDatastore($widgetScope.activeTblConfig,funcs,data,null,msg._msgid);
					}
					msg.payload = result;				
					$widgetScope.send(msg);
				})
				.catch(error => {
					msg.error = error;
					$widgetScope.send(msg);
				});
			return; 
		case "tbResetTable":
			debugLog($widgetScope.id+": reloading table from node configuration");
			if (!$widgetScope.props.multiUser)  // Clear datastore
				$widgetScope.clearDatastore(msg._msgid);
			if ($widgetScope.origTblConfig)
				createTable($widgetScope.origTblConfig,$widgetScope.origTblFuncs,$widgetScope)
			    .then(result => { 
					msg.payload = "Table reset to original configuration";
					$widgetScope.send(msg);
				})
				.catch(error => {
					msg.error = error;
					$widgetScope.send(msg);
				});
			else
			{
				destroyTable($widgetScope);
				$widgetScope.send(msg);
			}
			return;
		case "tbCellEditSync":	// internal command notifying an in-cell edit in another client
			debugLog($widgetScope.id+": received cell edit sync");
			cellEditSync($widgetScope,msg);
			return; 

		// Utility/testing commands
		//-------------------------
		case "tbTestConnection":
			msg.payload = "Test Connection";
			msg.nodeId = $widgetScope.id;
			msg.clientSockId = $widgetScope.$socket.id;
			if (!msg.listener)
				msg.listener = 'tbClientCommands';
			switch (msg.listener)
			{
				//case 'widget-action':
				//	$widgetScope.$socket.emit('widget-action', $widgetScope.id, msg)
				//	break;
				case 'tbSendMessage':
					$widgetScope.$socket.emit('tbSendMessage'/*+$widgetScope.id*/, $widgetScope.id, msg)
					break;
				case 'tbClientCommands':
					msg.tbClientCmd = 'tbTestConnection';
					$widgetScope.$socket.emit('tbClientCommands'/*+$widgetScope.id*/, $widgetScope.id, msg)
			}
			console.log("Sent connection test ping to listener "+msg.listener);
			return; 
		case 'tbShowDatastore':
			$widgetScope.showDatastore((msg.sendMsg ? true : false),msg._msgid);
			return; 
/*
		case "tbSetTableId":	// internal command to set an Id to the table's HTML Div, to allow direct API access from external nodes
			let divId = msg.tbTableId ? msg.tbTableId.trim() : "";
			if (divId === "" || divId.match(/^[a-zA-Z_-][a-zA-Z0-9_-]*$/) !== null)
			{
				$widgetScope.tblId = divId;
				$widgetScope.$refs.tabulatorDiv.id = divId;
			}
			else
				msg.error = "Invalid Table Id";
			$widgetScope.send(msg);
			return; 
*/
	}
	//------------------------------------------------------------------
	// Table commands (accepted only when table is built & ready)
	//------------------------------------------------------------------
	if (!$widgetScope.tblReady)
	{
		msg.error = 'Table does not exist';
		$widgetScope.send(msg);
		return;
	}
	switch (cmd)
	{
		//------------------------------------------------------------------
		// Node functions
		//------------------------------------------------------------------
		case "tbDestroyTable":
		case "destroy":  // Overloads Tabulator.destroy(), to enable graceful cleanup
			destroyTable($widgetScope,msg,true);
			if (!$widgetScope.props.multiUser)
				$widgetScope.saveToDatastore(null,null,null,null,msg._msgid);
				$widgetScope.send(msg);
			return; 
		case "tbSetStyle":
			setStyle(msg.tbScope,msg.tbStyles,$widgetScope,msg);
			return; 
		case "tbClearStyles":
			if ($widgetScope.activeTblConfig)
			{
				debugLog($widgetScope.id+": clearing styles, reloading table with current config & data");
				const cfg = cloneObj($widgetScope.activeTblConfig);
				const data = $widgetScope.tbl.getData();
				cfg.data = data;
				createTable(cfg,$widgetScope.activeTblFuncs,$widgetScope)
					.then(result => { 
						if (!$widgetScope.props.multiUser)
							$widgetScope.saveToDatastore($widgetScope.activeTblConfig,$widgetScope.activeTblFuncs,data,null,msg._msgid);
						msg.payload = "Table styles cleared";
						$widgetScope.send(msg);
					})
					.catch(error => {
						msg.error = error;
						$widgetScope.send(msg);
					});
			}
			return;
		case "tbSetGroupBy":
			if (!$widgetScope.props.allowMsgFuncs && msg.hasOwnProperty("tbGroupHeader") && hasInlineFuncs(msg.tbGroupHeader))
			{
				msg.error = "Messages containing function definitions are blocked in the node configuration";
				$widgetScope.send(msg);
				return;
			}
			setGroupBy($widgetScope,msg);
			return;
		//------------------------------------------------------------------
		// Managed Tabulator API calls
		//---------------------------------------------------------------------------------
		// Data-changing commands - called Async (response message is sent by the callback)
		//---------------------------------------------------------------------------------
		case "updateRow":
		case "updateOrAddRow":
			if ($widgetScope.props.validateRowIds && msg.tbArgs[1].hasOwnProperty($widgetScope.rowIdField))
			{
				const row = msg.tbArgs[1];
				if (!checkAddedDupRows([row],$widgetScope))
				{
					msg.error = "Duplicate row Id";
					$widgetScope.send(msg);
					return;
				}
			}
			tabulatorAsyncAPI(cmd,msg.tbArgs,msg,$widgetScope);
			return;
		case "setData":
		case "replaceData":
		case "updateData":
		case "updateOrAddData":
			if ($widgetScope.props.validateRowIds && !checkInputRowIds(msg.tbArgs[0],$widgetScope.rowIdField))
			{
				msg.error = "Duplicate or invalid row Id's";
				$widgetScope.send(msg);
			}
			else
				tabulatorAsyncAPI(cmd,msg.tbArgs,msg,$widgetScope);
			return;
		case "addData":
			if ($widgetScope.props.validateRowIds && (!checkInputRowIds(msg.tbArgs[0],$widgetScope.rowIdField) || !checkAddedDupRows(msg.tbArgs[0],$widgetScope)))
			{
				msg.error = "Duplicate or invalid row Id's";
				$widgetScope.send(msg);
			}
			else
				tabulatorAsyncAPI(cmd,msg.tbArgs,msg,$widgetScope);
			return;
		case "addRow":
			if ($widgetScope.props.validateRowIds)
			{
				const row = msg.tbArgs[0];
				const idField = $widgetScope.rowIdField;
				if (!row || !row.hasOwnProperty(idField) || row[idField] == undefined || row[idField] == null)
				{
					msg.error = "Invalid or missing row Id";
					$widgetScope.send(msg);
					return;
				}
				if (!checkAddedDupRows([row],$widgetScope))
				{
					msg.error = "Duplicate row Id";
					$widgetScope.send(msg);
					return;
				}
			}
			tabulatorAsyncAPI(cmd,msg.tbArgs,msg,$widgetScope);
			return;
		case "deleteRow":
			tabulatorAsyncAPI(cmd,msg.tbArgs,msg,$widgetScope);
			return;
		//------------------------------------------------------------------
		// Data-changing commands - called Sync
		//------------------------------------------------------------------
		case "clearData":
			tabulatorSyncAPI(cmd,msg.tbArgs,msg,$widgetScope);
			updateAndRespond(msg,$widgetScope);
			return;
		//------------------------------------------------------------------
		// Read-only commands (void or returning data) - called sync
		//------------------------------------------------------------------
		case "getData":
		case "getDataCount":
		case "searchData":
		case "getSelectedData":
		case "getFilters":

		case "showColumn":
		case "hideColumn":
		case "setSort":
		case "selectRow":
		case "deselectRow":
		case "setFilter":
		case "addFilter":
		case "removeFilter":
		case "clearFilter":
		case "download":
			tabulatorSyncAPI(cmd,msg.tbArgs,msg,$widgetScope);
			$widgetScope.send(msg);
			return;
		//------------------------------------------------------------------------------
		// Read-only commands (returning data) - called sync with special result parsing
		//------------------------------------------------------------------------------
		case "getRow":
			tabulatorSyncAPI(cmd,msg.tbArgs,msg,$widgetScope,function(rowComponent,msg){  // applies parser func on returned row component
				if (rowComponent)
					msg.payload = rowComponent.getData();
				else
					msg.error = "Invalid Row Id";
			});
			$widgetScope.send(msg);
			return;
		default:
		//------------------------------------------------------------------
		// Freehand (unmanaged) API call
		//------------------------------------------------------------------
			if (!cmd || typeof $widgetScope.tbl[cmd] !== "function")
			{
				msg.error = "Missing or invalid command";
				$widgetScope.send(msg);
				return;
			}
			tabulatorFreehandAPI(cmd,msg.tbArgs,msg,$widgetScope);
			return;
	}
}
// ********************************************************************************************************************
function updateAndRespond(msg,$widgetScope)
{
	//---------------------------------------------------------------------------------------------------------
	// Generic post-command handler, which:
	//   - for 'change' commands (in shared mode), updates the table's style map (if needed), and the datastore
	//   - sends a response command
	//---------------------------------------------------------------------------------------------------------
	if (!$widgetScope.props.multiUser)
	{
		// Update style map, in case rows have been added or deleted
		let map = $widgetScope.tblStyleMap;
		if (map)
		{
			let tbl = $widgetScope.tbl;
			let	rowIdField = $widgetScope.rowIdField;

			switch (msg.tbCmd)
			{
				case "setData":
				case "replaceData":
				//case "updateData": - nothing to do here
				case "addData":
				case "updateOrAddData":
					if (map.rows.length > 0)
					{
						const tblRows = tbl.getRows();
						map.rows = map.rows.filter((row) => {		// keep only row-style objects of rows which exists in the new data
							let index = tblRows.findIndex((rowComp) => rowComp.getCell(rowIdField).getValue() == row.rowId);  // not ===
							//console.log("row",row.rowId,found ? " found" : " not found");
							return index >= 0 ? true : false;
						});
					}
					applyFromStyleMap(map,tbl);
					break;
				case "addRow":
				// case "updateRow": - nothing to do here
				case "updateOrAddRow":
					//rowId = msg.tbArgs[0][rowIdField];
					//if (rowId && map.tblStyles)
					if (map.tblStyles)
						applyFromStyleMap(map,tbl)
					break;
				case "deleteRow":
					let rowId = msg.tbArgs[0];
					map.rows = map.rows.filter((row) => row.rowId != rowId); // not !==
					break;
				case "clearData":
					map.rows = [];
					break;
			}
		}
		updateDatastore($widgetScope,msg);
	}
	$widgetScope.send(msg);
}
// ********************************************************************************************************************
function createTable(cfg,funcs,$widgetScope)
//-------------------------------------------------------------------------------------------------------------
// Called asynchronously from: Initial load, tbCreateTable command, tbResetTable command, tbClearStyles command
//-------------------------------------------------------------------------------------------------------------
{
return new Promise((resolve, reject) => {

	if (!cfg)
	{
		reject("Invalid table configuration");
		return;
	}

	// Check row Id validity & no dups
	if (cfg.data && $widgetScope.props.validateRowIds)
	{
		const idField = cfg.hasOwnProperty("index") ? cfg.index : "id";
		if (!checkInputRowIds(cfg.data,idField))
		{
			const errMsg = "Invalid or duplicate row Id's"; 
			console.error(errMsg);
			reject(errMsg);
			return;
		}
	}

	// clone the configuration object (rather than pass it as reference), to protect from proxy issues
	const initObj = cloneObj(cfg);
	if (setFuncs(initObj,funcs) > 0) // errCount > 0, but continue table creation with bad functions, so user doesn't panic and can troubleshoot
	{
		console.error("Missing or Invalid user-defined functions");
		//reject("Missing or Invalid user-defined functions");
		//return;
	}

	// Create a new table
	//-------------------
	destroyTable($widgetScope);  // destroy current table (if exists)
	try  
	{
		if (!$widgetScope.tblDivId)
			$widgetScope.tbl = new Tabulator($widgetScope.$refs.tabulatorDiv, initObj);
		else
			$widgetScope.tbl = new Tabulator("#"+$widgetScope.tblDivId, initObj);
		
			// console.log("Table created");
			// $widgetScope.send({payload:"Table created"});
		
		// Table creation is asynchronous. The setup resumes after the table finished initializing, in the below "TableBuilt" callback
		//-----------------------------------------------------------------------------------------------------------------------
		$widgetScope.tbl.on("tableBuilt", function()    {

			if (cfg.hasOwnProperty("index"))	// overriding the default 'id' field as the row identifier
				$widgetScope.rowIdField = cfg.index;

			// Set notifications for the selected events 
			setEventNotifications($widgetScope);

			if ($widgetScope.props.events.includes("tableBuilt"))	// if 'tableBuilt' is explicitely specified in the notification list, send the notification from here
			{
				let eventMsg = new tbEventMsg("tableBuilt");
				eventMsg.payload = "Table built and ready";
				$widgetScope.sendNotification(eventMsg);
			}

			$widgetScope.tblReady = true;
			$widgetScope.activeTblConfig = cloneObj(cfg);
			delete $widgetScope.activeTblConfig.data;
			if (funcs)
				$widgetScope.activeTblFuncs = cloneObj(funcs);
			console.log($widgetScope.id+": Table built and ready");
            resolve("Table built and ready");
		});  // on TableBuilt
	}
	catch (err)
	{
		console.error($widgetScope.id+": Table creation failed",err);
		destroyTable($widgetScope);
		reject("Table creation failed");
	}	
}); // promise
}
// ********************************************************************************************************************
function initialTableLoad(dsImage,$widgetScope)
{
	// dsDummyImage = {ds:"Dummy"} - workaround: server does not send this event if no data in datastore, so we force dummy data

	if ($widgetScope.props.multiUser || !dsImage || dsImage.ds === "Dummy")
	{
		if ($widgetScope.origTblConfig)
		{
			console.log($widgetScope.id+": Creating table from node configuration");
			createTable($widgetScope.origTblConfig,$widgetScope.origTblFuncs,$widgetScope)
			    .then(result => {}) //{console.log("tbl init success, result=",result)})
				.catch(error => {}) //{console.error("tbl init error, err=",error)});
		}
		else
			console.log($widgetScope.id+": No table configuration, table not created.");
		return;
	}
	
	// shared mode with image in datastore
	if (!dsImage.config)  // stored image = 'no table' (not to confuse with 'no stored image')
	{
		console.log($widgetScope.id+": null table configuration in datastore");
		return;
	}
	
	// image has table definition
	console.log($widgetScope.id+": Creating table from datastore image");
	const initObj = dsImage.config;
	if (dsImage.data)
		initObj.data = dsImage.data;

	// create the table
	createTable(initObj,dsImage.funcs,$widgetScope)
		.then(result => {
			if (dsImage.styleMap)
			{
				applyFromStyleMap(dsImage.styleMap,$widgetScope.tbl);
				$widgetScope.tblStyleMap = dsImage.styleMap;
			}
		})
		.catch(error => {}) //{console.error("tbl init error, err=",error)});
}
// ********************************************************************************************************************
function destroyTable($widgetScope)
{
	//--------------------------------------------------------------------------
	// Called from: tbDestroyTable command, from within createTable, unmounted()
	//--------------------------------------------------------------------------

	if ($widgetScope.tbl)
	{
		$widgetScope.tbl.clearData();
		$widgetScope.tbl.destroy();
		console.log($widgetScope.id+": Table destroyed");
	}
	$widgetScope.tbl = null;
	$widgetScope.tblReady = false;
	$widgetScope.activeTblConfig = null;
	$widgetScope.activeTblFuncs = null;
	$widgetScope.tblStyleMap = null;
}
// ********************************************************************************************************************
function updateDatastore($widgetScope,msg)
{
	if (!$widgetScope.activeTblConfig)
	{
		$widgetScope.saveToDatastore(null,null,null,null,msg?._msgid);
		return;
	}

	$widgetScope.saveToDatastore(
		$widgetScope.activeTblConfig,
		$widgetScope.activeTblFuncs,
		$widgetScope.tblReady ? $widgetScope.tbl.getData() : null,
		$widgetScope.tblStyleMap,
		msg?._msgid
	);
}
// ********************************************************************************************************************
function setStyle(scope,styles,$widgetScope,msg)
{
/*  Logic:
if (no rowId) ==> all rows in table. Ignoring field
else if (rowId === "tbHeader")
	if (field) ==> single column header
	else	   ==> all column header
else 
	if (field) ==> single cell
	else  	   ==> whole row
*/
	let rowId = scope.hasOwnProperty("rowId") ? scope.rowId : null;
	let field = scope.field || "";
	const hdrRowId = "tbHeader";
	
	try  {
		if (rowId === undefined || rowId === null)	// Table scope: apply to all rows
		{
			let rowComponents = $widgetScope.tbl.getRows();
			for (let i = 0; i < rowComponents.length ; i++)
			{
				let element = rowComponents[i].getElement();
				applyStyles(element,styles);
			}
		}
		else if (rowId === hdrRowId)  // Header 
		{
			if (field)	// scope = single column header
			{
				let colComponent = $widgetScope.tbl.getColumn(field);
				let element = colComponent.getElement();
				applyStyles(element,styles);
			}
			else	// scope = all column headers
			{
				let hdrCells = $widgetScope.tbl.getColumns();
				for (let i = 0; i < hdrCells.length ; i++)
				{
					let element = hdrCells[i].getElement();
					applyStyles(element,styles);
				}
			}
		}
		else	// single row or cell
		{
			let rowComponent = $widgetScope.tbl.getRow(rowId);
			if (!rowComponent)
				msg.error = "Invalid row Id";
			else
			{
				if (field)	// ==>scope = single cell
				{
					let cellComponent = rowComponent.getCell(field);
					if (!cellComponent)
						msg.error = "Invalid field (column) name";
					else
					{
						let element = cellComponent.getElement();
						applyStyles(element,styles);
					}
				}
				else  // full row
				{
					let element = rowComponent.getElement();
					applyStyles(element,styles);
				}
			}
		}
	}
	catch  (err) {
		msg.error = err.message;
	}
	if (!msg.hasOwnProperty("error") && !$widgetScope.props.multiUser)
	{
		updateStyleMap($widgetScope,rowId,field,styles);
		updateDatastore($widgetScope,msg);
	}
	$widgetScope.send(msg);
}
// ********************************************************************************************************************
function applyStyles(element,styles)
{
	// example: cellObj.getElement().style.backgroundColor = "cyan";
	for (const prop in styles)
	{
		if (prop in element.style)
			element.style[prop] = styles[prop];
		else
			console.warn("Invalid style "+prop);
	}		
}
// ********************************************************************************************************************
function updateStyleMap($widgetScope,rowId,field,styles)
{
/*  Logic:
if (no rowId) ==> all rows in table. Ignoring field
else if (rowId === "tbHeader")
	if (field) ==> single column header
	else	   ==> all column header
else 
	if (field) ==> single cell
	else  	   ==> whole row
*/
	if (!$widgetScope.tblStyleMap)
		$widgetScope.tblStyleMap = new tbStyleMap();
	let map = $widgetScope.tblStyleMap;
	const hdrRowId = "tbHeader";
	
	if (rowId === undefined || rowId === null)	// Table scope
	{
		if (map.tblStyles)
			for (const prop in styles)  // merge styles
				map.tblStyles[prop] = styles[prop];
		else
			map.tblStyles = cloneObj(styles);
	}
	else if (rowId === hdrRowId)  // header
	{
		if (!map.hdrStyles)
			map.hdrStyles = {};
		if (field)	// single header
		{
			if (map.hdrStyles.hasOwnProperty(field))
				for (const prop in styles)  // merge styles
					map.hdrStyles[field][prop] = styles[prop];
			else
				map.hdrStyles[field] = cloneObj(styles);
		}
		else	// all headers
		{
			let hdrCells = $widgetScope.tbl.getColumns();
			for (let i = 0; i < hdrCells.length ; i++)
			{
				let colName = hdrCells[i].getField();
				if (map.hdrStyles.hasOwnProperty(colName))
					for (const prop in styles)  // merge styles
						map.hdrStyles[colName][prop] = styles[prop];
				else
					map.hdrStyles[colName] = cloneObj(styles);
			}
		}
	}
	else	// single row or cell
	{
		let rowObj = map.rows.find((obj)=> obj.rowId == rowId);  // not ===
		if (!rowObj)
		{
			rowObj = new tbStyleMapRow(rowId);
			map.rows.push(rowObj);
		}
		if (field)  // single cell
		{
			if (rowObj.cells.hasOwnProperty(field))
			{
				for (const prop in styles)  // merge styles
					rowObj.cells[field][prop] = styles[prop];
			}
			else
				rowObj.cells[field] = cloneObj(styles);
		}
		else  // whole row
		{
			if (rowObj.rowStyles)
			{
				for (const prop in styles)
					rowObj.rowStyles[prop] = styles[prop];
			}
			else
				rowObj.rowStyles = cloneObj(styles);
		}
	}
}
// ********************************************************************************************************************
function applyFromStyleMap(map,tbl)
{
	// first apply table-level styles
    if (map.tblStyles)
	{
		let rowComponents = tbl.getRows();
		for (let i = 0; i < rowComponents.length ; i++)
		{
			let element = rowComponents[i].getElement();
			applyStyles(element,map.tblStyles);
		}
	}
	// Now apply to header row
	if (map.hdrStyles)
	{
		if (map.hdrStyles)
			for (const field in map.hdrStyles)
			{
				let colComponent = tbl.getColumn(field);
				let element = colComponent.getElement();
				applyStyles(element,map.hdrStyles[field]);
			}
	}
	// now apply to rows, and cells within them
	for (let i = 0 ; i < map.rows.length ; i++)
	{
		let rowComponent = tbl.getRow(map.rows[i].rowId);
		if (rowComponent)
		{
			// apply row-level styles
			if (map.rows[i].rowStyles)
			{
				let element = rowComponent.getElement();
				applyStyles(element,map.rows[i].rowStyles);
			}
			// now apply cell styles
			for (const field in map.rows[i].cells)
			{
				let cellComponent = rowComponent.getCell(field);
				let element = cellComponent.getElement();
				applyStyles(element,map.rows[i].cells[field]);
			}
		}
	}
}
// ********************************************************************************************************************
function setGroupBy($widgetScope,msg)
{
	delete msg.error;
	if (!msg.tbFields || (Array.isArray(msg.tbFields) && msg.tbFields.length === 0))
	{
		$widgetScope.tbl.setGroupBy(false); // clear grouping
		$widgetScope.send(msg);
		return;
	}
	if (!msg.tbGroupHeader || (Array.isArray(msg.tbGroupHeader) && msg.tbGroupHeader.length === 0))
	{
		$widgetScope.tbl.setGroupBy(msg.tbFields);
		$widgetScope.send(msg);
		return;
	}
	const fields = Array.isArray(msg.tbFields)      ? msg.tbFields : [msg.tbFields];
	const hdrs   = Array.isArray(msg.tbGroupHeader) ? msg.tbGroupHeader : [msg.tbGroupHeader];
	
	if (hdrs.length > 1 && hdrs.length !== fields.length)
	{
		msg.error = "Mismatch between grouping fields and headers";
		$widgetScope.send(msg);
		return;
	}
		/*
		groupHeader:function(value, count, data, group){
			//value - the value all members of this group share
			//count - the number of rows in this group
			//data - an array of all the row data objects in this group
			//group - the group component for the group
		*/
	try {
		const funcArray = [];
		for (let i = 0 ; i < fields.length ; i++)
		{
			const str = (hdrs.length === 1 ? hdrs[0] : hdrs[i]) || "";
			if (TblFunc.prefix.test(str))
			{
				const funcDef = parseFuncProperty(str,$widgetScope.activeTblFuncs);
				if (typeof funcDef === "string")	// i.e. error
				{
					msg.error = "Invalid or missing group header function";
					$widgetScope.send(msg);
					return;
				}
				const f = createFunc(funcDef);
				if (typeof f === "function")
					funcArray.push(f);
				else
				{
					msg.error = "Invalid group header function:"+f;
					$widgetScope.send(msg);
					return;
				}
			}
			else
			{
				let func = function(value, count, data, group) {
					let h = str;
					h = h.replaceAll('$field',fields[i]);
					h = h.replaceAll('$value',value);
					h = h.replaceAll('$count',count);
					return h;
				};
				funcArray.push(func);
			}
			$widgetScope.tbl.setGroupBy(msg.tbFields);
			$widgetScope.tbl.setGroupHeader(funcArray.length !== 1 ? funcArray : funcArray[0]);
		}
	}
	catch (err)	{
		msg.error = "GroupBy error: "+err;
	}
	$widgetScope.send(msg);
}
// ********************************************************************************************************************
function cellEditSync($widgetScope,msg)
{
	debugLog("processing sync message on cell-edit in another client");
		
	let data = {};
	let idField = $widgetScope.rowIdField;
	data[idField] = msg.payload[idField];
	data[msg.payload.field] = msg.payload.value;
	try  {
		$widgetScope.tbl.updateData([data]);
	}
	catch (err)  {
		console.error($widgetScope.id+": Cell-edit sync failed:",err.message);
	}
	// Not sending a response msg to the flow, since this is an internal sync message
}
// ********************************************************************************************************************
// Tabulator API calls (Async, Sync, Auto)
// ********************************************************************************************************************
function tabulatorAsyncAPI(cmd,cmdArgs,msg,$widgetScope)
{
	debugLog("Calling '"+cmd+"', API mode=Async");
	let args = cmdArgs ? cloneObj(cmdArgs) : [];	// Clone the args to avoid proxy issues

	// Set functions into placeholder properties
	if (!$widgetScope.props.allowMsgFuncs && hasInlineFuncs(args))
	{
		msg.error = "Messages containing function definitions are blocked in the node configuration";
		$widgetScope.send(msg);
		return;
	}
	if (setFuncs(args,$widgetScope.activeTblFuncs) > 0) // errCount > 0
	{
		msg.error = "Missing or invalid user-defined function";
		$widgetScope.send(msg);
		return;
	}

	$widgetScope.tbl[cmd](...args)
		.then(function(xxx){
			updateAndRespond(msg,$widgetScope);
		})
		.catch(function(err){
			msg.error = err;
			updateAndRespond(msg,$widgetScope);	// update Datastore even upon error, as cmd may have been applied partially
		});
}
function tabulatorSyncAPI(cmd,cmdArgs,msg,$widgetScope,parserFunc)
{
	debugLog("Calling '"+cmd+"', API mode=Sync");
	let args = cmdArgs ? cloneObj(cmdArgs) : [];	// Clone the args to avoid proxy issues
	
	// Set functions into placeholder properties
	if (!$widgetScope.props.allowMsgFuncs && hasInlineFuncs(args))
	{
		msg.error = "Messages containing function definitions are blocked in the node configuration";
		$widgetScope.send(msg);
		return;
	}
	if (setFuncs(args,$widgetScope.activeTblFuncs) > 0) // errCount > 0
	{
		msg.error = "Missing or invalid user-defined function";
		$widgetScope.send(msg);
		return;
	}

	try  {
		let data = $widgetScope.tbl[cmd](...args);
		if (parserFunc)
			parserFunc(data,msg);
		else
			if (data !== undefined && data !== null)
				msg.payload = data;
	}
	catch (err) {
		msg.error = err.message;
	}
}
function tabulatorFreehandAPI(cmd,cmdArgs,msg,$widgetScope)
{
	debugLog("Calling '"+cmd+"', API mode=Freehand");
	let args = cmdArgs ? cloneObj(cmdArgs) : [];	// for some reason, sometime it doesn't work with the original args object

	// Execute the command in a way which supports both sync and async
	let response = $widgetScope.tbl[cmd](...args)

	let isPromise = !!response && typeof response === 'object' && typeof response.then === 'function';
	if (isPromise)
	{
		let result = Promise.resolve(response)
			.then((result)=> {
					$widgetScope.send(msg);
				})
			.catch((err)=> {
					msg.error = err;
					$widgetScope.send(msg);
				})
	}
	else
	{
		if (response !== undefined && response !== null)
			// Validate that the returned data is sendable in a msg
			if (isSendable(response))
				msg.payload = response;
			else
				msg.error = "API response cannot be serialized to a msg";
		$widgetScope.send(msg);
	}
}
function isSendable(obj)
{
	try  {
		let x = JSON.stringify(obj)
		return true;		
	}
	catch (err)  {
		// obj does not have a 'toJSON' function
		return false;
	}
}
// ********************************************************************************************************************
function setEventNotifications($widgetScope)
{
	let eventStr = $widgetScope.props.events;
	let eventArr = eventStr.split(',');
	
	// If required for client sync, force cell-edit notifications
	if (!$widgetScope.props.multiUser && !$widgetScope.props.events.includes("cellEdited"))
		eventArr.push("cellEdited");

	for (let i = 0 ; i < eventArr.length ; i++)
	{
		let ev = eventArr[i].trim();
		if (!ev)
			continue;
		switch (ev)
		{
		//-------------------------------------------------------
		// Table events
		//-------------------------------------------------------
			case "tableBuilt":	// Listener is set automatically during createTable(). If also explicitly requested in the events list, it will issue the notification from there
				break;
			case "tableDestroyed":  // Sent *after* table is destroyed
				$widgetScope.tbl.on(ev, function(){
					let eventMsg = new tbEventMsg(ev);
					$widgetScope.sendNotification(eventMsg);
				});
				break;
			case "dataChanged":
				$widgetScope.tbl.on(ev, function(data){
					let eventMsg = new tbEventMsg(ev);
					eventMsg.payload = data;
					$widgetScope.sendNotification(eventMsg);
				});
				break;
			case "columnMoved":
				$widgetScope.tbl.on(ev, function(column,colArr){
					let eventMsg = new tbEventMsg(ev);
					const fields = [];
					colArr.forEach((element) => fields.push(element.getField()));
					eventMsg.payload = {
						movedColumn: column.getField(),
						newColumnOrder:fields
					};
					$widgetScope.sendNotification(eventMsg);
				});
				break;
/*
			case "dataFiltered":
				$widgetScope.tbl.on(ev, function(filters,rows){	// filters - array of filters currently applied, rows = array of row components which pass the filters
					let filteredData = new Array(rows.length)
					for (let i = 0 ; i < rows.length ; i++)
						filteredData[i] = rows[i].getData();

					let eventMsg = new tbEventMsg(ev);
					eventMsg.payload = { filteredData: filteredData };
					$widgetScope.sendNotification(eventMsg);
				});
				break;
*/				
		//-------------------------------------------------------
		// Row events
		//-------------------------------------------------------
			case "rowClick":
			case "rowDblClick":
			case "rowTap":
			case "rowDblTap":
			case "rowTapHold":
				$widgetScope.tbl.on(ev, function(evObj,row){	// row = row component
					let eventMsg = rowEventMsg(row,ev);
					$widgetScope.sendNotification(eventMsg);
				});
				break;
			case "rowAdded":  	// sent upon addRow, updateOrAddRow, addData or updateOrAddData
			case "rowUpdated":	// sent only upon programmatic data update (updateRow, updateOrAddRow, updateData or updateOrAddData), not in-cell edits
			case "rowDeleted": // sent upon DeleteRow
			case "rowSelected": // sent upon manual or programmatic row selection
			case "rowDeselected": // sent upon manual or programmatic row deselection
			case "rowMoving": // event is triggered when a row has started to be dragged
			case "rowMoved": // event is triggered when a row has been successfully moved
			case "rowMoveCancelled": // event is triggered when a row has been moved but has not changed position in the table
				$widgetScope.tbl.on(ev, function(row){	// row = row component
					let eventMsg = rowEventMsg(row,ev);
					$widgetScope.sendNotification(eventMsg);
				});
				break;
		//-------------------------------------------------------
		// Cell events
		//-------------------------------------------------------
			case "cellEdited":
				$widgetScope.tbl.on(ev, function(cell)	{  // cell = cell component

					let eventMsg = new tbEventMsg(ev);
					
					let row = cell.getRow();
					let col = cell.getColumn();
					let rowIdField = $widgetScope.rowIdField;
					let rowId = row.getIndex();
					let field = col.getField();
					let value = cell.getValue();
					
					if ($widgetScope.props.events.includes("cellEdited"))	// Event is registered for notifications
					{
						eventMsg.payload =   {
							[rowIdField]: rowId,
							field:    field,
							newValue: value,
							oldValue: cell.getOldValue()
						}
						$widgetScope.sendNotification(eventMsg);
					}
					// if not multi-user, send client sync notification
					if (!$widgetScope.props.multiUser)
					{
						eventMsg.tbCmd = 'tbCellEditSync';
						eventMsg._client = {socketId:$widgetScope.$socket.id};
						eventMsg.payload = {
							[rowIdField]: rowId,
							field: field,
							value: value
						}
						//piggyback the DS image on the event, to allow server node to update the datastore
						eventMsg.dsImage = {
							timestamp: Date.now(),
							clientMsgId: eventMsg.notificationId,
							config: $widgetScope.activeTblConfig,
							funcs: $widgetScope.activeTblFuncs,
							data:   $widgetScope.tbl.getData(),
							styleMap: $widgetScope.tblStyleMap
						}
						$widgetScope.sendClientCommand("tbCellEditSync",eventMsg);	
					};
				});
				break;
			case "cellClick":
			case "cellTap":
			case "cellDblClick":
			case "cellDblTap":
			case "cellTapHold":
				$widgetScope.tbl.on(ev, function(e,cell){	// e = mouse event, cell = cell component
					let eventMsg = cellEventMsg(cell,ev);
					$widgetScope.sendNotification(eventMsg);
				});
				break;
			default:
				console.error("Event '"+ev+"' is not defined or unsupported");
				continue;
		}
		debugLog($widgetScope.id+": Set '"+ev+"' notifications");
	}
}
function rowEventMsg(row,ev)
{
	let evMsg = new tbEventMsg(ev);
	evMsg.payload = {
		rowIndex: row.getIndex(),
		rowData:  row.getData()
	}
	return	evMsg;
}
function cellEventMsg(cell,ev)
{
	let evMsg = new tbEventMsg(ev);
	evMsg.payload = {
		row:   cell.getRow().getIndex(),
		field: cell.getField(),
		value: cell.getValue(),
		type:  cell.getType()	// "cell" or "header"
	}
	return	evMsg;
}
// ********************************************************************************************************************
function loadThemeCSS(css,$widgetScope)
{
	// Load selected tabulator CSS file (currently global to the page)
	const tbThemeCSS = "omriTabulatorDynamicThemeCSS";
	const styleTags = document.getElementsByTagName("style");
	let exists = false;
	for (let i = 0; i < styleTags.length; i++)
		if (styleTags[i].id === tbThemeCSS)
		{
			exists = true;
			break;
		}
	if (!exists)
	{
		const el = document.createElement("style");
		el.type = "text/css";
		el.innerText = css; //"border:3px solid #add8e6;";
		el.id = tbThemeCSS;
		document.head.appendChild(el);
		console.log("Loaded CSS theme "+$widgetScope.props.themeFile);
	}
	else
		console.log("CSS theme already exists, ignoring");
}
// *********  Object Constructors  ****************************************************************
function tbStyleMap()
{
	this.tblStyles = null; // Table defaults
	this.hdrStyles = null; // Headers
	this.rows	   = []; // Array of row objects, each with row style + field-specific styles
}
function tbStyleMapRow(rowId)
{
	this.rowId	   = rowId;
	this.rowStyles = null;
	this.cells 	   = {};
}
function tbEventMsg(ev)
{
	this.topic = "tbNotification";
	this.event = ev;
	this.payload = {};
	this.notificationId = createUniqueId();
}
// *********  Utility functions  ****************************************************************
function checkInputRowIds(rows,idField)
{
	// Checks that the rows (to be added/updated in the table) have valid Ids, with no duplicates
	if (!Array.isArray(rows))
		return false;

    for (let i = 0 ; i < rows.length ; i++)
	{
		if (rows[i][idField] == undefined || rows[i][idField] == null)
			return false;

        for (let j = i+1 ; j < rows.length; j++)
            if (rows[i][idField] === rows[j][idField])
                return false;
	}
    return true;
/*
	let idArr = [];
	for (let i = 0 ; i < rows.length ; i++)
	{
		if (rows[i][idField] === undefined || rows[i][idField] === null)
			return false;
		idArr.push(rows[i][idField]);
	}
	if ((new Set(idArr)).size !== rows.length)
		return false;
	return true;
*/
}
function checkAddedDupRows(rows,$widgetScope)
{
	// Checks if added rows do not have the same Id as existing rows (to avoid duplicate Ids)
    const tblRows = $widgetScope.tbl.getRows();
	const idField = $widgetScope.rowIdField;

	for (let i = 0 ; i < rows.length ; i++)
	{
		if (tblRows.findIndex((rowComp)=> rowComp.getCell(idField).getValue() == rows[i][idField]) >= 0)
			return false;
	}
	return true;
/*	
    rowComps.forEach(function(rowComp) {
        let rowId = compRow.getCell($widgetScope.rowIdField).getValue());

		if (data.findIndex((e)=> e[rowIdField] == rows[i][rowIdField]) >= 0)
			return false;
		
	});

	let data = $widgetScope.tbl.getData();
	for (let i = 0 ; i < rows.length ; i++)
		if (data.findIndex((e)=> e[rowIdField] == rows[i][rowIdField]) >= 0)
			return false;
	return true;
*/
}
//-------------------------------------------------------------
// Table function management
//-------------------------------------------------------------
class TblFunc {
	// Static members
	static prefix = /^@F:\s*/;  // e.g. @F:myFunctionName, or @F:(a,b)=>{return a+b}
  
  //parse sheet
	// const splitRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*\{([^}]*)\}/msg; --- does not support nested {}
	static splitToFuncs = /function\s+/g ; //splits by the keyword 'function' (->the function body must not have another 'function' keyword inside it, not even as a comment)
	static matchNamed = /\s*(\S+)\s*\(([^)]*)\)\s*([^]*)/;  // Generic regex with 3 matching groups, to extract name, params & body
	static matchUnnamed = /^\(([^)]*)\)\s*=>([^]*)/;  // regex with 2 matching groups, to extract params & body of an inline function

	static pName = '[a-zA-Z_$][a-zA-Z0-9_$]*';  // JS function & param names can only have letters, digits, '$' and '_', and cannot start with a digit
	static fName	  = new RegExp('^'+this.pName+'$'); 
	static fParams = new RegExp(`^${this.pName}\\s*(,\\s*${this.pName}\\s*)*$|^\\s*$`); // zero or more params, comma-separated
	static fBody = /^\{[^]*\}$/;  // checking if enclosed in curly brackets. Unable to check JS syntax validity
	
	static trimFuncTail(str)	{  //.replace(/([^]*})([^]*)/, '$1')
		const index = str.lastIndexOf('}'); // Find the position of the last '}'
        if (index !== -1) // If found, trim the remainder
			return str.substring(0, index + 1);
		else
			return str;
	}
}
function parseFuncSheet(str)
{
	if (!str)
		return {};

	const funcList = {};

	//	first, split the sheet into separate function blocks
	const rawFuncs = str.split(TblFunc.splitToFuncs);
	for (let i = 0 ; i < rawFuncs.length ; i++)
	{
		if (rawFuncs[i].trim() !== '')
		{
			const func = TblFunc.trimFuncTail(rawFuncs[i]);  // trim out trailing text (e.g. comments) after the last '}'

			const match = func.match(TblFunc.matchNamed) // extract name, params & body
			if (match !== null)
			{
				const name   = match[1].trim();
				const params = match[2].trim();
				const body   = match[3].trim();

				// test valididty
				if (!TblFunc.fName.test(name))
				{
					console.warn("->Invalid function name:",name);
					continue;
				}
				if (!TblFunc.fParams.test(params))
				{
					console.warn(`->Invalid function params: ${name} (${params})`);
					continue;
				}
				if (!TblFunc.fBody.test(body))
				{
					console.warn(`->Invalid function body: ${name} (${params.replace(/[\s]/g,'')}) ${body}`);
					continue;
				}
				let cleanParams = params.replace(/[\s]/g,'');
				funcList[name] = {
						params: cleanParams ? cleanParams.split(',') : [],
						body: body
					}
			}
			else 
				console.warn("->Invalid function definition: "+func);
		}
    }
    return funcList;
}
function parseFuncProperty(str,funcs)
{
	const func = str.replace(TblFunc.prefix,'').trim(); // strip off the prefix & surrounding whitespaces

	if (TblFunc.fName.test(func))	// if function name only, lookup in predefined function list
	{
		if (funcs.hasOwnProperty(func))
			return funcs[func];
		else
			return "Function not found";
	}
	
	const match = func.match(TblFunc.matchUnnamed) // function is unnamed, extract params & body
	if (match === null)
		return "Invalid function definition";

	const params = match[1].trim();
	const body   = match[2].trim();

	// test valididty
	if (!TblFunc.fParams.test(params))
		return "Invalid function params "+params;
	if (!TblFunc.fBody.test(body))
		return "Invalid function body "+body;

	let cleanParams = params.replace(/[\s]/g,'');
	const funcObj = {
			params: cleanParams ? cleanParams.split(',') : [],
			body: body
		}
    return funcObj;
}
function setFuncs(obj,funcs)
{
	let errCount = 0;

	if (Array.isArray(obj))
	{
        for (let i = 0; i < obj.length; i++)
		{
            if (typeof obj[i] === 'string')
			{
				if (TblFunc.prefix.test(obj[i]))
				{
					let funcDef = parseFuncProperty(obj[i],funcs)
					if (typeof funcDef === "string") // error
					{
						console.warn(funcDef);
						errCount++;
					}
					else
					{
						const f = createFunc(funcDef);
						if (typeof f === "function")
							obj[i] = f;
						else
						{
							console.warn(f);
							errCount++;
						}
					}
				}
			}
            else
                errCount += setFuncs(obj[i],funcs);
		}
	}
	else if (typeof obj === 'object' && obj !== null)
	{
		Object.keys(obj).forEach (key => {
			if (typeof obj[key] === "string")
			{
				if (TblFunc.prefix.test(obj[key]))
				{
					let funcDef = parseFuncProperty(obj[key],funcs)
					if (typeof funcDef === "string") // error
					{
						console.warn(funcDef);
						errCount++;
					}
					else
					{
						const f = createFunc(funcDef);
						if (typeof f === "function")
							obj[key] = f;
						else
						{
							console.warn(f);
							errCount++;
						}
					}
				}
			}
			else
				errCount += setFuncs(obj[key],funcs)	// recurse through
		});
	}
	return errCount;
}	
function hasInlineFuncs(obj)
{
	const matchRegex = /^@F:\s*\([^]*\)\s*=>/;

    if (typeof obj === 'string')
        return matchRegex.test(obj);
	else if (Array.isArray(obj))
		return obj.some(item => hasInlineFuncs(item));
	else if (typeof obj === 'object' && obj !== null)
        return Object.values(obj).some(value => hasInlineFuncs(value));
    return false;
}	
function createFunc(funcObj)
{
	//const params = cloneObj(funcObj.params);
	//const body   = cloneObj(funcObj.body);
	try {
		let f = new Function(...funcObj.params,funcObj.body);
		return f;
	}
	catch (err)  {
		// console.error(err);
		return ("Invalid function: "+err);
	}
}
//-----------------------------------------------------------------------------------------
function cloneObj(obj)
{
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (obj instanceof Date) {
        return new Date(obj);
    }
    if (obj instanceof Array) {
        return obj.map(item => cloneObj(item));
    }
    if (obj instanceof Function) {
		// return obj.bind({});
		return null;
    }

    const clonedObj = {};
	Object.keys(obj).forEach (key => {
		clonedObj[key] = cloneObj(obj[key]);
	});
	// for (let key in obj) {
	//    if (obj.hasOwnProperty(key)) { -- not ot take inherited properties
	//        clonedObj[key] = deepClone(obj[key]);
	//    }

	return clonedObj;
/*
	let clone = null;
	try  {
		clone = structuredClone(obj);
		return clone;
	}
	catch (err)	{
		try	{
			clone = JSON.parse(JSON.stringify(obj));
			return clone;
		}
		catch (err)	{
			console.error("Object cloning failed:",err);
		}
	}
	return null;
*/
	// 		return structuredClone(obj);
	//		clone = loadsh.cloneDeep(obj);
	//		clone = JSON.parse(JSON.stringify(obj));
	//		clone = RED.util.cloneMessage(obj);
}
function createUniqueId()
{
	return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
							(+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16));
}
function debugLog(t1,t2,t3,t4)
{
	if (window.tbPrintToLog)
		console.log("ui-tabulator:",t1, t2||"", t3||"", t4||"");
}
// *******************************************************************************************************************************
</script>
<style>
@import  "../../node_modules/tabulator-tables/dist/css/tabulator.min.css"
</style>

<style scoped>
/* CSS is auto scoped, but using named classes is still recommended */
.ui-tabulator-wrapper {
}
.ui-tabulator-class {
}
</style>
