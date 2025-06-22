# About _ui-tabulator_
The **ui-tabulator** custom node uses the popular [Tabulator](https://www.tabulator.info) JavaScript package, for updating, presenting &AMP; querying UI tables.
> **Note:** the node comes in addition to, not replacing, dashboard V2.0's native vue-based **table** node.

## Architecture
This node, as all third-party (non-core) nodes for Node-RED Dashboard 2.0, are structured so that they extend the core `ui-template` node, and provide access for defining custom HTML, CSS, and JavaScript for your widget.
