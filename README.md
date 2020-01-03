Welcome to the IBM Food Trust&trade; Developer Zone!

# IFT Developer Documentation
You will find documentation on our WIKI.

# IFT API Examples
The code in this repository is intended to be a collection of code examples that exemplify the capabilities of the IBM Food Trust APIs.

## Recall Assistant
The recall assistant is an application that demonstrates how to use the Trace API's events endpoint to help determine useful information in the event of a recall stemming from a source location.  This is only an example as it presents assumptions about data that may not apply to all supply chains.  Currently it also does not implement paging so will only work with data amounts that do not require paging.  It services three endpoints:

### harvested-epcs
This returns a list of EPCs that were harvested from a particular location within a particular timeframe, for a set of GTINs.

### impacted-epcs
This returns a list of EPCs that contain ingredients harvested from a particular location within a particular timeframe, for a set of GTINs.  This assumes that the harvested EPCs were transformed directly into other EPCs (or were never transformed), and does not attempt to handle multiple layers of transformation, or aggregations into transformations.

### impacted-transactions
This returns a list of transaction identifiers (purchase order IDs and despatch advice IDs) that contain ingredients that were harvested from a particular location within a particular timeframe, for a set of GTINs.  This assumes that the harvested EPCs were transformed directly into other EPCs (or were never transformed), and does not attempt to handle multiple layers of transformation, or aggregations into transformations.  It also assumes that the impacted EPCs are shipped to a partner as a child of an aggregation event and that the transaction IDs are referenced on that event.
