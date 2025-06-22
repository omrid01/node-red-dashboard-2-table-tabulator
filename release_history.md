# ui-tabulator Release History

## v0.8.0, 22-June-2025

* Internal update &AMP; optimization of node<->widget communication framework and datastore structure
* Bypass the default **'widget-action'** message handler, to avoid the overrun of **msg.topic** with **undefined**.
* Support for additional table events: **cellEditing** &AMP; **cellEditCancelled**

## v0.7.2, 17-May-2025

* Introducing a new property **tbName** in all output messages, with the configured node name (or, if name is not configured, the node Id). This enables to identify the sending table in case of multiple table nodes.
* In notification messages, moved the **tbNotification** descriptor from **msg.topic** to a new property **msg.msgType**. This comes to work around a dashboard bug (introduced in v2.3.0) which overrides **msg.topic** and sets it to **undefined** (dashboard issue #1683).

## v0.7.1, 26-Mar-2025

* Bug-fix: typo in function name (causing runtime error), affecting commands such as setData, replaceData etc.

## v0.7.0, 18-Mar-2025

* Added a new framework, supporting _server-node_ commands (commands handled by the server node, available even when there are no open clients). Current supported commands:
	* tbShowDatastore
	* tbGetDsData
	* tbGetDsDataCount
	* tbGetClientCount
* DEPRECATED: loading tabulator CSS theme files from a URL is no longer supported, due to sync/async issues
* Optimization & improvements in datastore access
* Fixes in _Custom Functions_ validation, in node configuration
* Improvement in promise-handling of async API commands
* Fixes & improvements in dynamic styling (**tbSetStyle** command)
* Fixes in table grouping (**tbSetGroupBy** command)
* Enabling per-node custom CSS, via predefined wrapper classes
* Code modularization & cleanup

## v0.6.4, 26-Jan-2025

* Supporting new events - row & column movements
* Notifications now sent with full client object (appended by the dashboard framework)
* Warning on messaging the node while no connected clients will be issued only in debug mode
* New utility command - get count of connected clients
* Bump Tabulator to v6.3

## v0.6.3, 21-Dec-2024

Modified the node's interface with the Node-RED datastore, following a breaking change in datastore behavior in the latest Dashboard-2 release.
The new release of ui-tabulator node remains backwards compatible to older Dashboard-2 versions.

## v0.6.2, 19-Dec-2024

* Fixed the dataChanged event handler, closing issue #7
* Detect messages sent to the table from the flow when there are no connected clients (hence message is being discarded by Node-RED), and issuing a respective error message.
This does not solve the challenge completely (e.g., when there's a connected client which does not have the table).

## v0.6.1, 4-Dec-2024

Fixed a styling issue in Firefox (issue #6)

## v0.6.0, 24-Nov-2024

* Introducing a new feature: support for Tabulator functions as part table configuration & commands. This closed issue #4.
* Improved node configuration dialog, including the ability to expand text areas
* New object cloning method, to avoid Vue proxy issues
* Fix in handling styling commands