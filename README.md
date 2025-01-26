# Table node (using Tabulator) for Node-RED Dashboard 2.0

A short summary of the node's design concepts, functionality & configuration options. Complete, detailed usage reference is provided in the node's on-line help, available in the Node-RED editor.
# ui-tabulator
![example-pic](https://github.com/omrid01/node-red-dashboard-2-table-tabulator/assets/100078999/2e7bac34-94e3-49c1-bd69-cdb3dade5abd)

The **ui-tabulator** custom node uses the popular [Tabulator](https://www.tabulator.info) JavaScript package, for updating, presenting & querying UI tables.
> **Note:** the node comes in addition to, not replacing, dashboard V2.0's native vue-based **table** node.

#### General Overview
* The node serves as a smart wrapper containing a Tabulator (table) object. For the most part, it calls the Tabulator API as-is (as defined in the [Tabulator Documentation](https://tabulator.info/docs/6.2)).
* The node enables automatic instantiation of the table (with user-defined configuration & initial data), as well as to dynamically create/modify/destroy  tables in runtime.
* Interface to the node is through messages (regular Node-red **msg** objects). The msg specifies a command (and arguments), and returns the table's response
* The table accepts data-setting commands (e.g. setData, addData, updateData, deleteData etc.) as well as data-query commands (getData, searchData etc.), as well as in-cell data edit (from the UI).
* In addition, the table can send unsolicited event messages for selected table events (cell & row click/double-click, cell edit etc.)
* By default, the table operates in **_shared_** mode, i.e. a common table image (data + styling) in all concurrent dashboard clients. The table image is also cached in the Node-RED datastore, and reloaded upon browser open, refresh etc.  
The node also supports a **_Multi-User_** mode, which maintains independent, client-specific table data with "private" messaging.

#### Message Examples
* Data-setting command example
```
msg.tbCmd  = "addData";
msg.tbArgs = [
   [
      {id:1, name:"bob", gender:"male"},
      {id:2, name:"Jenny", gender:"female"}
   ],
   true
];
```
* Data-retrieval command example
```
msg.tbCmd  = "searchData";
msg.tbArgs = [ "age", ">", 12 ];
```
* Event example
```
{
    topic: "tbNotification",
    event: "cellEdited",
    payload: {
        id: 2,
        field: "name",
        newValue: "Jack Brown",
        oldValue: "John Doe"
    },
    _client: {
        socketId: "uXRxjY9yO-Hya1vtAAAB"
    },
    _msgid:"6d9d7a97666f2783"
}
```
#### Node Configuration
The node configuration properties (in the editor):
* **Name, Group, Size**: - same as in all dashboard 2.0 nodes
* **Initial Table Configuration**: JSON object with all table & column definitions, and (optional) initial data
* **Custom Functions**: logical expressions for custom or dynamic table settings, e.g. conditional formatting, user-defined filters/validators etc.
* **Allow functions in messages**: (Y/N) - security option to block function injection in runtime 
* **Max Width**: sets the maximum visible width of the table
* **Notifications**: selection of table events which trigger notification messages
* **Multi-user** mode: (Y/N)
* **Row-Id validation/duplication** check (Y/N)
* **CSS theme**: selection of an optional tabulator CSS Stylesheet (e.g. **_Midnight_**, **_Modern_** etc.)
* **DIV Override**: optional: enables to specify the HTML DIV Id in which the table will be created, overriding the default auto-allocated DIV

#### Architectural Concepts in Multi-Client Environment
Tables are created as **_widgets_** on the client (browser) page. Hence, in case of multiple dashboard clients, a single **_ui-tabulator_** node is associated to multiple table widgets. Per Node-RED's framework, every message sent to a **_ui-tabulator_** node in a flow, is replicated to all of its widgets. If the table object responds, the flow will receive multiple, identical responses (one per client). To enable a **_Shared_** mode, where all table widgets are synchronized and have a common data image, we do the following:
* Data-setting & styling commands sent from the **_ui-tabulator_** node in flow to all table widgets in parallel, thus applying the same changes on the widgets
* The (identical) table responses to command messages are grouped by **_msgid_**, and only a single response is returned to the flow
* When a user changes table data directly on the UI of any client, an update notification is automatically sent to all other clients
* The current table data image is always saved in the Node-RED datastore, automatically restoring the table image upon client open/refresh.

Having said the above, some table presentation aspects (on top of the common data image) are user-related by nature, and are not synchronized. For example, users may want to set their own filtering/sorting, or select specific rows for further actions. In such cases, each client table may return a different response to data query commands. For this, the command should be scoped to a specific table widget (by specifying the client Id, or initiating the command from a dashboard objet, e.g. button, on the same client)

#### Known Issues
Upon server restart, deploy and reconnect, sometimes the client's socket listeners in the Node-RED framework are not restored properly. As a temporary workaround, until this is fixed in Node-RED, each client page automatically reloads itself once upon reconnection (showing a little "flicker").

#### Node Dependencies
* Node-JS version >= 18
* Node-red version >= 3.10
* Node-red dashboard 2.0, version >= 1.22.0
* Tabulator version >= 6.3 (comes bundled in the node installation)
