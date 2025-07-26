<template>
	<div class="ui-tabulator-wrapper">
		<div ref="tabulatorDiv" class="ui-tabulator-class"></div>
    </div>
</template>
<style>
@import  "../../node_modules/tabulator-tables/dist/css/tabulator.min.css"
</style>
<script>
//import { DateTime } from 'luxon';
import * as luxon from 'luxon';
window.luxon = luxon;

import {TabulatorFull as Tabulator} from 'tabulator-tables';
import { markRaw } from 'vue'
import { mapState } from 'vuex'
import {} from '../../nodes/common.js'

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
			tbl: 		 	null,	// reference to the table object
			tblReady:	 	false,	// Indicates that table has completed initializing
			tblDivId:		"",		// Optional, allows table instantiation on a specified Div
			tblName:		"",		// Table alias, either the node name (if defined) else node id
			rowIdField:		"id",	// The name of the field which holds the unique row Id (the default is 'id', but can be overridden)
			silentCellUpdate:false,  // Flag for allowing silent cell update without sending a 'cellEdited' notification

			origTblConfig:	null,	// original table configuration, as configured in the node (converted from JSON to an object). null=no table config in the node
			origTblFuncs:	null,	// Original the custom functions configured in the node (converted from text to an object). null=no functions

			activeTblConfig:null,	// active table configuration (excluding data & funcs). null=no active table
			activeTblFuncs:	null,	// active functions. null = none
			tblStyleMap:	null, 	// styles assigned to the table (via the tbSetStyle command)
			tblHeaderRowId:	"tbHeader" // mock rowId value for the header styling
		}
    },
// ******************************************************************************************************************************************
    mounted () {
	
		//tbTestImport.sayHello(); // test that 'common.js' was imported successfully
	
		const vThis = this; // Save the Vue 'this' scope for socket listener, callbacks, external functions etc.
		this.tblName = this.props.name || this.id;  // set the table alias
		
		window.tbPrintToLog = this.props.printToLog;
		debugLog(`***ui-tabulator node ${this.tblName} mounted on client ${this.$socket.id}, debug=${window.tbPrintToLog?"on":"off"}`);

		// parse the original table configuration & funcs (from node configuration)
		const cfgStr = this.props.initObj?.trim();
		if (cfgStr)
		{
			let cfg = null;
			try  {
				cfg = JSON.parse(cfgStr);
				if (cfg && Object.keys(cfg).length > 0)
					this.origTblConfig = cfg;
			}
			catch (err) {
				cfg = null;
				console.error("Table "+vThis.tblName+": Invalid table configuration:",err);
			}
		}
		this.origTblFuncs = tbParseFuncSheet(this.props.funcs);
		
		// Load CSS theme
		if (this.props.themeCSS)
			loadThemeCSS(this.props.themeCSS,this);

		if (this.props.tblDivId);
		{
			this.tblDivId = this.props.tblDivId?.trim() || "";
			// this.$refs.tabulatorDiv.style.display = "none";  // hide the original DIV
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
			if (!msg || !acceptMsg(msg,vThis))
				return;
			processMsg(msg,vThis);
		});
		
		// ****************************************************************************************
		// Utility listener for custom server-node notifications
		// ****************************************************************************************
		this.$socket.on('tbServerEvent:' + this.id, (msg) => {

			//^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
			// Temp workaround (due to NR framework bug) - force client to reload every time server-node is restarted
			//-------------------------------------------------------------------------------------------------------
			if (msg?.tbCmd === "tbReloadClient")
			{
				console.log("Table "+vThis.tblName+": Received reload request");

				// setTimeout(()=>location.reload(),5000);
				location.reload();
				return;
			}
			//^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

			if (!msg || !acceptMsg(msg,vThis))
				return;
			processMsg(msg,vThis);
		});
		
		// ***************************************************************************************************
		// msg listener for 'widget-load' event, sent from server when widget is loaded (with datastore image)
		// ***************************************************************************************************
		this.$socket.on('widget-load:' + this.id, (msg) => {
			debugLog("Table "+vThis.tblName+" Loaded DS image:",msg);
			initialTableLoad(msg.tblImage,this)
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
        //  widget-send just sends a msg to Node-RED, it does not store the msg state server-side
        //  alternatively, you can use widget-change, which will also automatically store the msg in the Node's datastore
		sendNotification(msg) {
			msg.tbName = this.tblName;
			//this.$socket.emit('widget-send', this.id, msg)
			this.$socket.emit('widget-action', this.id, msg)
        },
		sendResponse(msg) {
			if (!msg.tbDoNotReply || (!this.props.multiUser && msg.hasOwnProperty("dsImage")))
			{
				msg.tbName = this.tblName;
				this.$socket.emit('widget-action', this.id, msg)
			}
        }
	}
// ******************************************************************************************************************************************
}  // end of export default
// ******************************************************************************************************************************************
// My functions
// ******************************************************************************************************************************************
// Determine if the client should accept the incoming message
function acceptMsg(msg,vThis)
{
	// filter out commands handled by the server node (but are still broadcasted by Node-red to the dashboard)
	switch (msg.tbCmd)
	{
		case "tbShowDatastore":
		case "tbGetDsData":
		case "tbGetDsDataCount":
		case "tbGetClientCount":
			return false;
	}
	
	 // accept the special utility msg for testing client/server connections. bypasses all scope constraints
	if (msg.tbCmd === "tbTestConnection")
		return true;

	let msgClientId = msg?._client?.socketId || "";  // get client Id

	// Check if msg includes an explicitly-specified client scope
	if (msg.hasOwnProperty("tbClientScope"))
	{
		switch (msg.tbClientScope)
		{
			case "tbAllClients":
				return true;
			case "tbSameClient":
				return (msgClientId && msgClientId === vThis.$socket.id);
			case "tbNotSameClient":
				return (msgClientId !== vThis.$socket.id);
			case "tbNone":
			default:
				return false;
		}
	}
	
	// Always accept msg if not from a specific client
	if (!msgClientId)
		return true;
		
	// When msg from specific client, accept per shared/multiUser mode
	if (vThis.props.multiUser)  // in multi-user, accept only from own client
		return (msgClientId === vThis.$socket.id);
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
			return (msgClientId === vThis.$socket.id);
	}
}
// ********************************************************************************************************************
function processMsg(msg,vThis)
{
	delete msg.error;
	const cmd = msg.tbCmd;
	
	switch (cmd)
	{
//------------------------------------------------------------------
// Table creation & deletion commands
//------------------------------------------------------------------
		case "tbCreateTable":
			debugLog("Table "+vThis.tblName+": creating table from msg");
			if (!msg.tbInitObj)
			{
				msg.error = "Invalid table configuration";
				vThis.sendResponse(msg);
				return;
			}
			if (!vThis.props.allowMsgFuncs && (!!msg.tbFuncs || hasInlineFuncs(msg.tbInitObj)))
			{
				msg.error = "Messages with function definitions are blocked in the node configuration";
				vThis.sendResponse(msg);
				return;
			}
			
			const funcs = tbParseFuncSheet(msg.tbFuncs);
			createTable(msg.tbInitObj,funcs,null,vThis)
			    .then((result) => { 
					if (!vThis.props.multiUser)
					{
						const data = msg.tbInitObj.data || [];
						msg.dsImage = {config:vThis.activeTblConfig,funcs:funcs,data:data,styleMap:null};
					}
					msg.payload = result;				
				})
				.catch((error) => {
					msg.error = error.message;
					if (!vThis.props.multiUser)
						msg.dsImage = {config:null,funcs:null,data:null,styleMap:null};
				})
				.finally(()=>{ vThis.sendResponse(msg) });
			return;
		case "tbDestroyTable":
		case "destroy":  // Overloads Tabulator.destroy(), to enable graceful cleanup
			destroyTable(vThis);
			if (!vThis.props.multiUser)
				msg.dsImage = {config:null,funcs:null,data:null,styleMap:null};
			vThis.sendResponse(msg);
			return; 
		case "tbResetTable":
			debugLog("Table "+vThis.tblName+": reloading table from node configuration");

			createTable(vThis.origTblConfig,vThis.origTblFuncs,null,vThis)
            .then((val)=>{
				msg.payload = "Table reset to original configuration";
				if (!vThis.props.multiUser)
				{
					const cfg = cloneObj(vThis.origTblConfig);
					const data = cfg.data || [];
					delete cfg.data;
					msg.dsImage = {config:cfg,funcs:vThis.origTblFuncs,data:data,styleMap:null};
				}
			})
            .catch((err)=>{console.log("Table creation error:",err)})
			.finally(()=>{vThis.sendResponse(msg)});
            return;
//------------------------------------------------------------------
// internal synchronization commands
//------------------------------------------------------------------
		case "tbCellEditSync":	// internal sync command received when a cell is edited (from UI) in another client
			debugLog("Table "+vThis.tblName+": received cell edit sync");
			cellEditSync(msg,vThis);
			return; 
//------------------------------------------------------------------
// utility & testing commands
//------------------------------------------------------------------
		case "tbTestConnection":
			msg.payload = "Test Connection";
			msg.nodeId = vThis.id;
			msg.clientSockId = vThis.$socket.id;
			console.log("Sending connection test ping to listener 'widget-action'");
			vThis.$socket.emit('widget-action', vThis.id, msg);
			return; 
/*
		case "tbSetTableId":	// internal command to set an Id to the table's HTML Div, to allow direct API access from external nodes
			let divId = msg.tbTableId ? msg.tbTableId.trim() : "";
			if (divId === "" || divId.match(/^[a-zA-Z_-][a-zA-Z0-9_-]*$/) !== null)
			{
				vThis.tblId = divId;
				vThis.$refs.tabulatorDiv.id = divId;
			}
			else
				msg.error = "Invalid Table Id";
			vThis.sendResponse(msg);
			return; 
*/
	}
//------------------------------------------------------------------
// Table commands (accepted only when table is built & ready)
//------------------------------------------------------------------
	if (!vThis.tblReady)
	{
		msg.error = 'Table does not exist or is not ready';
		vThis.sendResponse(msg);
		return;
	}
	const args = msg.tbArgs ? cloneObj(msg.tbArgs) : [];	// Clone the args array to avoid proxy issues
	if (!vThis.props.allowMsgFuncs && hasInlineFuncs(args))
	{
		msg.error = "Messages with function definitions are blocked in the node configuration";
		vThis.sendResponse(msg);
		return;
	}
// ***********************************************
	switch (cmd)
	{
//------------------------------------------------------------------
// wrapped/enhanced table-handling commands
//------------------------------------------------------------------
		case "tbSetStyle":
			setStyle(msg.tbScope,msg.tbStyles,msg,vThis);
			return; 
		case "tbClearStyles":
			// reload table (with its current configuration), dropping all styles
			debugLog("Table "+vThis.tblName+": clearing styles, reloading table with current config & data");
			const cfg = cloneObj(vThis.activeTblConfig);
			const data = vThis.tbl.getData();
			cfg.data = data;
			createTable(cfg,vThis.activeTblFuncs,null,vThis)
				.then(result => { 
					if (!vThis.props.multiUser)  
						// update only style map
						msg.dsImage = {styleMap:null};
					msg.payload = "Table styles cleared";
				})
				.catch(error => {
					msg.error = error.message;
					if (!vThis.props.multiUser)
						msg.dsImage = {config:null,funcs:null,data:null,styleMap:null};
				})
				.finally(()=>{ vThis.sendResponse(msg) });
			return;
		case "tbSetGroupBy":
			if (!vThis.props.allowMsgFuncs && msg.hasOwnProperty("tbGroupHeader") && hasInlineFuncs(msg.tbGroupHeader))
			{
				msg.error = "Messages with function definitions are blocked in the node configuration";
				vThis.sendResponse(msg);
				return;
			}
			setGroupBy(msg,vThis);
			return;
// ********************************************************************************
// direct Tabulator API calls
// ********************************************************************************
// data-changing commands
//-----------------------------------------------------------------------------------------------------------------
	// async invocation (Tabulator API call returns a promise, response message is sent once processing is complete
	//-------------------------------------------------------------------------------------------------------------
		case "setData":
		case "replaceData":
		case "updateData":
		case "updateOrAddData":
			// check that all input rows have valid and unique Ids
			if (vThis.props.validateRowIds && !checkInputRowIds(args[0],vThis.rowIdField))
			{
				msg.error = "Missing, invalid or duplicate input row Id's";
				vThis.sendResponse(msg);
				return;
			}
			tabulatorAsyncAPI(cmd,args,msg,vThis);
			return;
		case "addData":
			// check that all input rows have valid and unique Ids, and also detect duplication of existing Ids
			if (vThis.props.validateRowIds && (!checkInputRowIds(args[0],vThis.rowIdField) || !checkAddedDupRows(args[0],vThis)))
			{
				msg.error = "Missing, invalid or already existing row Id's";
				vThis.sendResponse(msg);
				return;
			}
			tabulatorAsyncAPI(cmd,args,msg,vThis);
			return;
		case "addRow":
			if (vThis.props.validateRowIds && (!checkInputRowIds([args[0]],vThis.rowIdField) || !checkAddedDupRows([args[0]],vThis)))
			{
				msg.error = "Missing, invalid or already existing row Id";
				vThis.sendResponse(msg);
				return;
			}
			tabulatorAsyncAPI(cmd,args,msg,vThis);
			return;
		case "updateOrAddRow":
			if (vThis.props.validateRowIds && !checkInputRowIds([args[1]],vThis.rowIdField))  // checking the 2d argument
			{
				msg.error = "Missing or invalid row Id in data object";
				vThis.sendResponse(msg);
				return;
			}
			tabulatorAsyncAPI(cmd,args,msg,vThis);
			return;
		case "updateRow":
		case "deleteRow":
			// no pre-validation needed
			tabulatorAsyncAPI(cmd,args,msg,vThis);
			return;
	//----------------------------------------------------------------------------------------------------	
	// synchronous invocation (Tabulator API call returns immediately)
	//----------------------------------------------------------------------------------------------------
		case "clearData":
			tabulatorSyncAPI(cmd,args,msg,vThis);
			adjustStyleMap(msg,vThis);
			if (!vThis.props.multiUser)
				msg.dsImage = {data:[],styleMap:vThis.tblStyleMap};
			vThis.sendResponse(msg);
			return;
//-----------------------------------------------------------------------------------------------------------------
// Data non-changing commands (queries etc.) - always synchronous invocation (Tabulator API call returns immediately)
//-----------------------------------------------------------------------------------------------------------------
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
			if (setFuncs(args,vThis.activeTblFuncs) > 0) // errCount > 0
				console.warn("Missing or invalid user-defined function");
			msg.payload = tabulatorSyncAPI(cmd,args,msg,vThis);
			vThis.sendResponse(msg);
			return;
		//------------------------------------------------------------------------------
		// data-query commands called sync, which require special result parsing
		//------------------------------------------------------------------------------
		case "getRow":
			const rowComponent = tabulatorSyncAPI(cmd,args,msg,vThis)
			if (rowComponent)
				msg.payload = rowComponent.getData();
			else
				msg.error = "Invalid Row Id";
			vThis.sendResponse(msg);
			return;
		default:
		//------------------------------------------------------------------
		// Freehand (unsupervised) API call (undocumented)
		//------------------------------------------------------------------
			if (cmd && typeof vThis.tbl[cmd] === "function")
				tabulatorFreehandAPI(cmd,args,msg,vThis);
			else
			{
				msg.error = "Missing or invalid command";
				vThis.sendResponse(msg);
			}
			return;
	}
}
// ********************************************************************************************************************
// Tabulator API call wrappers (Async, Sync)
// ********************************************************************************************************************
function tabulatorAsyncAPI(cmd,args,msg,vThis)
{
	debugLog("Calling '"+cmd+"', API mode=Async");

	vThis.tbl[cmd](...args)
		.then((resolveVal)=>{ debugLog("resolve value for async API=",resolveVal)})
		.catch((err)=>{
			console.error("Async API error",err);
			msg.error = err.message
		})
		.finally(()=>{
			adjustStyleMap(msg,vThis);
			if (!vThis.props.multiUser)
				msg.dsImage = {data:vThis.tbl.getData(),styleMap:vThis.tblStyleMap};
			vThis.sendResponse(msg); // update Datastore even upon error, as cmd may have been applied partially
		});
}
//----------------------------------------------------
function tabulatorSyncAPI(cmd,args,msg,vThis)
{
	debugLog("Calling '"+cmd+"', API mode=Sync");

	try  {
		const data = vThis.tbl[cmd](...args);
		return data;
	}
	catch (err) {
		msg.error = err.message;
	}
}

function tabulatorFreehandAPI(cmd,args,msg,vThis)
{
	debugLog("Calling '"+cmd+"', API mode=Freehand");
	const notSendable = "API response cannot be serialized to a msg";

	// Execute the command in a way which supports both sync and async
	let response = null;
	try {
		response = vThis.tbl[cmd](...args)
		//	const isPromise = !!response && typeof response === 'object' && typeof response.then === 'function'; 
		if (response instanceof Promise)
		{
			response.then((resolveVal)=>{
				console.log("Freehand async API executed, resolve value=",resolveVal);
				msg.payload = isSendable(resolveVal) ? resolveVal : notSendable;					
			})
			.catch((err)=>{
				console.error("Freehand async API failure, error=",err);
				msg.error = err.message;
			})
			.finally(()=>{	vThis.sendResponse(msg) })
		}	
		else  // handle sync result
		{
			console.log("Freehand sync API executed, response=",response);
			if (response !== undefined && response !== null)
				msg.payload = isSendable(response) ? response : notSendable;					
			else
				msg.payload = response;
			vThis.sendResponse(msg);
		}
	}
	catch (err) {  // handle sync error
		console.error("Freehand sync API failure, error=",err);
		msg.error = err.message;
		vThis.sendResponse(msg);
	}
}
function isSendable(obj)
{
	try  {
		let x = JSON.stringify(obj)
		return true;		
	}
	catch (err)  {
		// obj not serializable or does not have a 'toJSON' function
		return false;
	}
}

// ********************************************************************************************************************
function adjustStyleMap(msg,vThis)
{
//-----------------------------------------------------------------------------------
// following data-changing commands, adjust/apply the table's style map (if needed):
// - new rows: apply column & table scoped styles
// - deleted rows: remove them from the style map
//-----------------------------------------------------------------------------------
	// Update style map, in case rows have been added or deleted
	const map = vThis.tblStyleMap;
	if (map)
	{
		const tbl = vThis.tbl;
		const rowIdField = vThis.rowIdField;

		switch (msg.tbCmd)
		{
			case "setData":
			case "replaceData":
			case "clearData":
				// remove all row & cell styles
				map.rows = []; // no need to re-apply on the table
				break;
			case "addData":
			//case "updateData": - nothing to do here
			case "updateOrAddData":
			case "addRow":
			// case "updateRow": - nothing to do here
			case "updateOrAddRow":
				applyFromStyleMap(vThis)  // apply table & column scoped styles on added rows
				break;
			case "deleteRow":
				// remove deleted rows from map structure. no need to re-apply  on table
				const rowId = msg.tbArgs[0];
				map.rows = map.rows.filter((row) => row.rowId != rowId); // not !==
				break;
		}
	}
}
// ********************************************************************************************************************
function createTable(cfg,funcs,styleMap,vThis)
//------------------------------------------------------------------------------------------------------
// Called asynchronously from: Initial load, and the commands tbCreateTable, tbResetTable, tbClearStyles
//------------------------------------------------------------------------------------------------------
{
return new Promise((resolve, reject) => {

	// Check row Id validity & no dups
	if (vThis.props.validateRowIds && Array.isArray(cfg?.data) && !checkInputRowIds(cfg.data,vThis.rowIdField))
	{
		const errMsg = "Missing, invalid or duplicate row Id's in table configuration"; 
		console.error(errMsg);
		reject(errMsg);
		return;
	}

	destroyTable(vThis);  // destroy current table (if exists)
	if (!cfg)
	{
		resolve("Null table configuration - table not created");
		return;
	}

	// clone the configuration object (rather than pass it as reference), to protect from proxy issues
	const initObj = cloneObj(cfg);

	// create & set the functions in the configuration
	const activeFuncs = !!funcs ? funcs : vThis.origTblFuncs;
	if (setFuncs(initObj,activeFuncs) > 0) // errCount > 0, but allow table creation with missing functions, so user doesn't panic and can troubleshoot
	{
		console.warn("Missing or Invalid user-defined functions");
		//reject("Missing or Invalid user-defined functions");
		//return;
	}

	// Create the new table
	//-------------------
	try  
	{
		if (!vThis.tblDivId)
			vThis.tbl = new Tabulator(vThis.$refs.tabulatorDiv, initObj);
		else
			vThis.tbl = new Tabulator("#"+vThis.tblDivId, initObj);
		
			//console.log("Table created");
			//vThis.sendNotification(new tbEventMsg("Table created"));
		
		// Table creation is asynchronous. The setup resumes after the table finished initializing, in the below "TableBuilt" callback
		//----------------------------------------------------------------------------------------------------------------------------
		vThis.tbl.on("tableBuilt", function()    {
			if (cfg.hasOwnProperty("index"))	// overriding the default 'id' field as the row identifier
				vThis.rowIdField = cfg.index;

			// Set notifications for the selected events 
			setEventNotifications(vThis);

			if (vThis.props.events.includes("tableBuilt"))	// if 'tableBuilt' is explicitely specified in the notification list, send the notification from here
			{
				let eventMsg = new tbEventMsg("tableBuilt");
				eventMsg.payload = "Table built and ready";
				vThis.sendNotification(eventMsg);
			}

			vThis.activeTblConfig = cloneObj(cfg);
			delete vThis.activeTblConfig.data;
			vThis.activeTblFuncs = cloneObj(activeFuncs);
			
			if (styleMap)
			{
				vThis.tblStyleMap = cloneObj(styleMap);
				applyFromStyleMap(vThis);
			}
			else
				vThis.tblStyleMap = null;

			vThis.tblReady = true;
			console.log("Table "+ vThis.tblName + " built and ready");
            resolve("Table built and ready");
		});  // on TableBuilt
	}
	catch (err)
	{
		console.error("Table "+vThis.tblName+": Table creation failed",err);
		destroyTable(vThis);
		reject("Table creation failed");
	}	
}); // promise
}
// ********************************************************************************************************************
function destroyTable(vThis)
{
	//---------------------------------------------------------------------------------------
	// Called synchronously from: unmounted(), tbDestroyTable command,
	// and as part of createTable, resetTable & clearStyles
	//----------------------------------------------------------------------------------------

	if (vThis.tbl)
	{
		vThis.tbl.clearData();
		vThis.tbl.destroy();
		console.log("Table "+vThis.tblName+": Table destroyed");
	}
	vThis.tbl = null;
	vThis.tblReady = false;
	vThis.activeTblConfig = null;
	vThis.activeTblFuncs = null;
	vThis.tblStyleMap = null;
}
// ********************************************************************************************************************
function initialTableLoad(dsImage,vThis)
{
	// multi-user mode: no datastore, create table from node configuration
	//--------------------------------------------------------------------
	if (vThis.props.multiUser)
	{
		if (vThis.origTblConfig)
		{
			console.log("Table "+vThis.tblName+": Creating table from node configuration");
			createTable(vThis.origTblConfig,vThis.origTblFuncs,null,vThis)
			    .then((result) => {}) //{console.log("tbl init success, result=",result)})
				.catch((error) => {}) //{console.error("tbl init error, err=",error)});
		}
		else
			console.log("Table "+vThis.tblName+": No table configuration, table not created.");
		return;
	}
	
	// shared mode: load from datastore
	//------------------------------------
	if (!(dsImage?.config))  // no stored image, or image = 'no table'
	{
		console.log("Table "+vThis.tblName+": No configuration in datastore, table not created.");
		return;
	}
	
	// image has table definition
	console.log("Table "+vThis.tblName+": Creating table from datastore image");
	const initObj = dsImage.config;
	if (dsImage.data)
		initObj.data = dsImage.data;

	// create the table
	createTable(initObj,dsImage.funcs,dsImage.styleMap,vThis)
		.then((result) => {})
		.catch((error) => {}) //{console.error("tbl init error, err=",error)});
}
// ********************************************************************************************************************
// Style management
//------------------------------------------------------------------------
function setStyle(scope,styles,msg,vThis)
{
/*  Logic:
msg.tbScope = {};                             // affects the whole table
msg.tbScope = {field:"name"};		          // affects the whole column "name"
msg.tbScope = {rowId:"tbHeader"};             // affects all headers
msg.tbScope = {rowId:"tbHeader",field:"name"};// affects the header of column "name"
msg.tbScope = {rowId:2};                      // affects all row 2
msg.tbScope = {rowId:2,field:"name"};         // affects the cell in row 2, column "name"
*/
	const rowId = (scope && scope.rowId !== undefined && scope.rowId !== null) ? scope.rowId : null;
	const field = scope?.field || null;

	let newMap = false;
	if (!vThis.tblStyleMap)
	{
		newMap = true;
		vThis.tblStyleMap = new tbStyleMap();
	}
	const map = vThis.tblStyleMap;
	
	try  {
		// Scope = whole table -----------------------------------------------
		if (rowId === null && field === null)
		{
			const rowComponents = vThis.tbl.getRows();
			for (let i = 0; i < rowComponents.length ; i++)
			{
				const element = rowComponents[i].getElement();
				applyStyles(element,styles);
			}
			// update styleMap
			if (!map.tblStyles)
				map.tblStyles = {};
			map.tblStyles = addStyles(map.tblStyles,styles);
		}
		// Scope = single column -----------------------------------------------
		else if  (rowId === null && field !== null)
		{
			const colComponent = vThis.tbl.getColumn(field);
			if (!colComponent)
			{
				msg.error = "Invalid field (column) name";
				throw ""
			}
			const cells = colComponent.getCells();
			for (let i = 0; i < cells.length ; i++)
			{
				const element = cells[i].getElement();
				applyStyles(element,styles);
			}
			// update styleMap
			if (!map.colStyles)
				map.colStyles = {};
			map.colStyles[field] = addStyles(map.colStyles[field],styles);
		}
		// Scope = all or single column headers -----------------------------------------------
		else if (rowId === vThis.tblHeaderRowId)
		{
			if (!map.hdrStyles)
				map.hdrStyles = {};

			// Scope = all column headers -----------------------------------------------
			if (field === null)
			{
				const hdrCells = vThis.tbl.getColumns();
				for (let i = 0; i < hdrCells.length ; i++)
				{
					const colName = hdrCells[i].getField();
					if (colName)
					{
						const element = hdrCells[i].getElement();
						applyStyles(element,styles);
						// update styleMap
						map.hdrStyles[colName] = addStyles(map.hdrStyles[colName],styles);
					}
				}
			}
			// Scope = single column header -----------------------------------------------
			else  // field !== null
			{
				const colComponent = vThis.tbl.getColumn(field);
				if (!colComponent)
				{
					msg.error = "Invalid field (column) name";
					throw ""
				}
				const element = colComponent.getElement();
				applyStyles(element,styles);
				// update styleMap
				map.hdrStyles[field] = addStyles(map.hdrStyles[field],styles);
			}
		}
		// Scope = whole row or single cell ----------------------------------------
		else  // rowId !== null && rowId !== header row Id
		{
			const rowComponent = vThis.tbl.getRow(rowId);
			if (!rowComponent)
			{
				msg.error = "Invalid row Id";
				throw "";
			}
			let rowObj = map.rows.find((obj)=> obj.rowId == rowId);  // not ===
			if (!rowObj)
			{
				rowObj = new tbStyleMapRow(rowId);
				map.rows.push(rowObj);
			}
			// Scope = whole row --------------------------------------------------
			if (field === null)
			{
				const element = rowComponent.getElement();
				applyStyles(element,styles);
				// update styleMap
				if (!rowObj.rowStyles)
					rowObj.rowStyles = {};
				rowObj.rowStyles = addStyles(rowObj.rowStyles,styles);
			}
			// Scope = single cell --------------------------------------------------
			else  // field !== null
			{
				const cellComponent = rowComponent.getCell(field);
				if (!cellComponent)
				{
					msg.error = "Invalid field (column) name";
					throw "";
				}
				const element = cellComponent.getElement();
				applyStyles(element,styles);
				// update styleMap
				if (!rowObj.cellStyles)
					rowObj.cellStyles = {};
				rowObj.cellStyles[field] = addStyles(rowObj.cellStyles[field],styles);
			}
		}
	}
	catch {
		if (newMap)
			vThis.tblStyleMap = null;
		//console.log("Omri: error");
	}
	finally  {
		if (!vThis.props.multiUser)
			msg.dsImage = {styleMap:vThis.tblStyleMap};
		vThis.sendResponse(msg)
	}
}
//------------------------------------------------------------------------------------------
function applyFromStyleMap(vThis)
{
	const map = vThis.tblStyleMap;
	if (!map)
		return;
	const tbl = vThis.tbl;
		
	// 1st, apply table-level styles
	if (map.tblStyles)
	{
		const rowComponents = tbl.getRows();
		for (let i = 0; i < rowComponents.length ; i++)
		{
			const element = rowComponents[i].getElement();
			applyStyles(element,map.tblStyles);
		}
	}
	// 2nd, apply to columns
	if (map.colStyles)
	{
		for (let field in map.colStyles)
		{
			const colComponent = vThis.tbl.getColumn(field);
			if (colComponent)
			{
				const cells = colComponent.getCells();
				for (let i = 0; i < cells.length ; i++)
				{
					const element = cells[i].getElement();
					applyStyles(element,map.colStyles[field]);
				}
			}
			else
				console.error("Invalid column in style map");
		}
	}
	// 3rd, apply to header row
	if (map.hdrStyles)
	{
		for (let field in map.hdrStyles)
		{
			const colComponent = tbl.getColumn(field);
			if (colComponent)
			{
				const element = colComponent.getElement();
				applyStyles(element,map.hdrStyles[field]);
			}
			else
				console.error("Invalid column header in style map");
		}
	}
	// 4th, apply to rows, and/or individual cells
	for (let i = 0 ; i < map.rows.length ; i++)
	{
		let rowComponent = tbl.getRow(map.rows[i].rowId);
		if (rowComponent)
		{
			// 4.1 apply row-level styles
			if (map.rows[i].rowStyles)
			{
				const element = rowComponent.getElement();
				applyStyles(element,map.rows[i].rowStyles);
			}

			// 4.2 apply cell-specific styles
			if (map.rows[i].cellStyles)
				for (let field in map.rows[i].cellStyles)
				{
					const cellComponent = rowComponent.getCell(field);
					if (cellComponent)
					{
						const element = cellComponent.getElement();
						applyStyles(element,map.rows[i].cellStyles[field]);
					}
					else
						console.error("Invalid cell in style map");
				}
		}
		else
			console.error("Invalid row in style map");
	}
}
//------------------------------------------------------------------------------------------
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
function addStyles(mapObj,styles)
{
	if (!mapObj)
		mapObj = {};
	for (let prop in styles)
		mapObj[prop] = styles[prop];
	return mapObj;
}
// ********************************************************************************************************************
// Group-by handling
//-----------------------------------------------------------------
function setGroupBy(msg,vThis)
{
	delete msg.error;
	try  {  // reply messages will be sent in 'finally'
		if (!msg.tbFields || (Array.isArray(msg.tbFields) && msg.tbFields.length === 0))
		{
			vThis.tbl.setGroupBy(false); // clear grouping
			return;
		}
		const fields = Array.isArray(msg.tbFields) ? msg.tbFields : [msg.tbFields];
		if (setFuncs(fields,vThis.activeTblFuncs) > 0) // errCount > 0
		{
			msg.error = "Invalid or missing grouping field function";
			return;
		}
		vThis.tbl.setGroupBy(fields);

		// set group headers
		if (!msg.tbGroupHeader || (Array.isArray(msg.tbGroupHeader) && msg.tbGroupHeader.length === 0))
		{
			vThis.tbl.setGroupHeader(); // clear existing headers
			return;
		}

		const hdrs = Array.isArray(msg.tbGroupHeader) ? msg.tbGroupHeader : [msg.tbGroupHeader];
		if (hdrs.length > 1)
		{
			if(hdrs.length !== fields.length)
			{
				msg.error = "Mismatching number of grouping fields and headers";
				return;
			}
		}
		else  // hdrs.length === 1
		{
			// replicate the header array to the length of the fields array
			for (let j = 1 ; j < fields.length ; j++)
				hdrs[j] = hdrs[0];
		}
		// Set the @F: functions
		if (setFuncs(hdrs,vThis.activeTblFuncs) > 0) // errCount > 0
		{
			msg.error = "Invalid or missing grouping-header function";
			return;
		}
		// set the default function into headers which did not have @F: functions
		for (let i = 0 ; i < hdrs.length ; i++)
		{
			if (typeof hdrs[i] !== "function")
			{
				// groupHeader:function(value, count, data, group){
				//	value - the value all members of this group share
				//	count - the number of rows in this group
				//	data - an array of all the row data objects in this group
				//	group - the group component for the group

				let h = hdrs[i];
				hdrs[i] = function(value, count, data, group) {
					h = h.replaceAll('$field',fields[i]);
					h = h.replaceAll('$value',value);
					h = h.replaceAll('$count',count);
					return h;
				};
			}
		}
		vThis.tbl.setGroupHeader(hdrs);
	}
	catch (err)	{
		msg.error = "GroupBy error: "+err;
	}
	finally  { vThis.sendResponse(msg) }
}
// ********************************************************************************************************************
function cellEditSync(msg,vThis)
{
/*  
	// old implementation - does not support nested data
	let data = {};
	data[msg.payload.idField] = msg.payload.rowId;
	data[msg.payload.field]   = msg.payload.value;

	vThis.tbl.updateData([data])
		.then((resolveVal)=>{ debugLog("Updated cell. resolve value=",resolveVal)})
		.catch((err)=>{
			console.error("Table "+vThis.tblName+": Cell-edit sync failed:",err.message)
		});
*/
	debugLog("processing sync message from cell-edit in another client");

	const rowComponent = vThis.tbl.getRow(msg.payload.rowId);
	const cellComponent = rowComponent.getCell(msg.payload.field);

	vThis.silentCellUpdate = true; // suppress "cellEdit" notification. will be reset back in the event callback
	cellComponent.setValue(msg.payload.value);

	// Not sending a response msg to the flow, since this is an internal sync message
}
// ********************************************************************************************************************
function setEventNotifications(vThis)
{
	let eventStr = vThis.props.events;
	let eventArr = eventStr.split(',');
	
	// If required, force cell-edit notifications
	if (!vThis.props.events.includes("cellEdited") && !vThis.props.multiUser)
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
				vThis.tbl.on(ev, function(){
					const eventMsg = new tbEventMsg(ev);
					vThis.sendNotification(eventMsg);
				});
				break;
			case "dataChanged":
				vThis.tbl.on(ev, function(data){
					const eventMsg = new tbEventMsg(ev);
					eventMsg.payload = data;
					vThis.sendNotification(eventMsg);
				});
				break;
			case "columnMoved":
				vThis.tbl.on(ev, function(column,colArr){
					const eventMsg = new tbEventMsg(ev);
					const fields = [];
					colArr.forEach((element) => fields.push(element.getField()));
					eventMsg.payload = {
						movedColumn: column.getField(),
						newColumnOrder:fields
					};
					vThis.sendNotification(eventMsg);
				});
				break;
/*
			case "dataFiltered":
				vThis.tbl.on(ev, function(filters,rows){	// filters - array of filters currently applied, rows = array of row components which pass the filters
					let filteredData = new Array(rows.length)
					for (let i = 0 ; i < rows.length ; i++)
						filteredData[i] = rows[i].getData();

					const eventMsg = new tbEventMsg(ev);
					eventMsg.payload = { filteredData: filteredData };
					vThis.sendNotification(eventMsg);
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
				vThis.tbl.on(ev, function(evObj,row){	// row = row component
					const eventMsg = rowEventMsg(row,ev);
					vThis.sendNotification(eventMsg);
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
				vThis.tbl.on(ev, function(row){	// row = row component
					const eventMsg = rowEventMsg(row,ev);
					vThis.sendNotification(eventMsg);
				});
				break;
		//-------------------------------------------------------
		// Cell events
		//-------------------------------------------------------
			case "cellEdited":
				vThis.tbl.on(ev, function(cell)	{  // cell = cell component
					if (vThis.silentCellUpdate)  {		// flag was set to true prior to a programmatic cell update (cellComponent.setValue() )
						vThis.silentCellUpdate = false; // reset to normal
						return;
					}
					const eventMsg = new tbEventMsg(ev);
					
					const row = cell.getRow();
					const col = cell.getColumn();
					const rowIdField = vThis.rowIdField;
					const rowId = row.getIndex();
					const field = col.getField();
					const value = cell.getValue();
					
					if (vThis.props.events.includes("cellEdited"))	// Event is registered for notifications
					{
						eventMsg.payload =   {
							[rowIdField]: rowId,
							field:    field,
							newValue: value,
							oldValue: cell.getOldValue()
						}
						vThis.sendNotification(eventMsg);
					}
					// if not multi-user, send client sync notification
					if (!vThis.props.multiUser)
					{
						const syncMsg = new tbEventMsg("tbCellEditedSync");
						syncMsg.payload = {
							idField: rowIdField,
							rowId:   rowId,
							field:   field,
							value:   value
						}
						vThis.sendNotification(syncMsg);
					};
				});
				break;
			case "cellEditing":
			case "cellEditCancelled":
				vThis.tbl.on(ev, function(cell){	// cell = cell component
					const eventMsg = cellEventMsg(cell,ev);
					vThis.sendNotification(eventMsg);
				});
				break;
			case "cellClick":
			case "cellTap":
			case "cellDblClick":
			case "cellDblTap":
			case "cellTapHold":
				vThis.tbl.on(ev, function(e,cell){	// e = mouse event, cell = cell component
					const eventMsg = cellEventMsg(cell,ev);
					vThis.sendNotification(eventMsg);
				});
				break;
			default:
				console.error("Event '"+ev+"' is not defined or unsupported");
				break;
		}
		debugLog("Table "+vThis.tblName+": Set '"+ev+"' notifications");
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
function loadThemeCSS(css,vThis)
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
		console.log("Loaded CSS theme "+vThis.props.themeFile);
	}
	else
		console.log("CSS theme already exists, ignoring");
}
// *********  Input validation functions  ****************************************************************
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
//--------------------------------------------------
function checkAddedDupRows(rows,vThis)
{
	// Checks if added rows do not have the same Id as existing rows (to avoid duplicate Ids)
    const tblRows = vThis.tbl.getRows();
	const idField = vThis.rowIdField;

	for (let i = 0 ; i < rows.length ; i++)
	{
		if (tblRows.findIndex((rowComp)=> rowComp.getCell(idField).getValue() == rows[i][idField]) >= 0)
			return false;
	}
	return true;
/*	
    rowComps.forEach(function(rowComp) {
        let rowId = compRow.getCell(vThis.rowIdField).getValue());

		if (data.findIndex((e)=> e[rowIdField] == rows[i][rowIdField]) >= 0)
			return false;
		
	});

	let data = vThis.tbl.getData();
	for (let i = 0 ; i < rows.length ; i++)
		if (data.findIndex((e)=> e[rowIdField] == rows[i][rowIdField]) >= 0)
			return false;
	return true;
*/
}
// ************************************************************************************************
// Unscoped functions (no vThis)
// ************************************************************************************************
// Object Constructors 
//---------------------------------------------------
function tbStyleMap()
{
	this.tblStyles = null; // table defaults - apply to all table rows
	this.hdrStyles = null; // header object, with column-specific styles
	this.colStyles = null; // column-specific styles, which apply to the whole column
	this.rows	   = [];   // array of row objects, each with row Id, row styles & cell-specific styles
}
function tbStyleMapRow(rowId)
{
	this.rowId	   	= rowId;
	this.rowStyles 	= null;
	this.cellStyles = null;
}
function tbEventMsg(ev)
{
	this.msgType = "tbNotification";
	this.event = ev;
	this.payload = {};
	this.notificationId = createUniqueId();
}
//-------------------------------------------------------------
// Table function management
//-------------------------------------------------------------
// tbParseFuncSheet() and tbFuncUtils() - are imported from common.js 

function parseFuncProperty(str,funcs)
{
	const func = str.replace(tbFuncUtils.prefix,'').trim(); // strip off the prefix & surrounding whitespaces

	if (tbFuncUtils.fName.test(func))	// if function name only, lookup in predefined function list
	{
		if (funcs.hasOwnProperty(func))
			return funcs[func];
		else
			return "Function not found";
	}
	
	const match = func.match(tbFuncUtils.matchUnnamed) // function is unnamed, extract params & body
	if (match === null)
		return "Invalid function definition";

	const params = match[1].trim();
	const body   = match[2].trim();

	// test valididty
	if (!tbFuncUtils.fParams.test(params))
		return "Invalid function params "+params;
	if (!tbFuncUtils.fBody.test(body))
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
				if (tbFuncUtils.prefix.test(obj[i]))
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
				if (tbFuncUtils.prefix.test(obj[key]))
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
    if (typeof obj === 'string')
        return tbFuncUtils.inlineFuncs.test(obj);
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
	return clonedObj;

	// 		return structuredClone(obj);
	//		clone = loadsh.cloneDeep(obj);
	//		clone = JSON.parse(JSON.stringify(obj));
	//		clone = RED.util.cloneMessage(obj);
}
function createUniqueId()
{
	let id = Math.random().toString(36);
	id = id.replace(/^../,"ev");
    while (id.length < 16)
    {
        let pad = "" + Date.now(); //timestamp, 13 chars
        id += pad.slice(-(16-id.length));
    }
    return id;
	
//	return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
//							(+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16));
}
function debugLog(t1,t2,t3,t4)
{
	if (window.tbPrintToLog)
		console.log("ui-tabulator:",t1, t2||"", t3||"", t4||"");
}
</script>