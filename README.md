Welcome to the IBM Food Trust&trade; Developer Zone!

# IFT Developer Documentation
You will find documentation for IFT development on our WIKI.

# IBM Trace API Extensions
The code in this repository is intended to be a collection of code examples that exemplify the capabilities of the IBM Blockchain Transparent Supply Trace API.

## Recall Scenarios
The following are code examples that demonstrates how to use the Trace API's events endpoint to help determine useful information in the event of a recall stemming from a source location.  This is only an example as it presents assumptions about data that may not apply to all supply chains.

### harvested-epcs
This returns a list of EPCs that were harvested from a particular location within a particular timeframe, for a set of GTINs.

### impacted-epcs
This returns a list of EPCs that contain ingredients harvested from a particular location within a particular timeframe, for a set of GTINs.  This assumes that the harvested EPCs were transformed directly into other EPCs (or were never transformed), and does not attempt to handle multiple layers of transformation, or aggregations into transformations.

### impacted-transactions
This returns a list of transaction identifiers (purchase order IDs and despatch advice IDs) that contain ingredients that were harvested from a particular location within a particular timeframe, for a set of GTINs.  This assumes that the harvested EPCs were transformed directly into other EPCs (or were never transformed), and does not attempt to handle multiple layers of transformation, or aggregations into transformations.  It also assumes that the impacted EPCs are shipped to a partner as a child of an aggregation event and that the transaction IDs are referenced on that event.

### ingredient-sources
This returns a list of products with their final locations alongside their ingredients and the source locations for each of the ingredients.  This will make assumptions about the overall flow of products (it will assume a `STORE` is a more likely final location than a `FARM`, and the reverse for source locations).  In CSV format, it will also limit the final/source locations to a single location each, sorted by timestamp and by the assumption described previously.

### product-destinations
This endpoint will provide a list of ingredients and the source locations alongside the most downstream product they produce (same formatting as `/ingredient-sources`).  This will make assumptions about the overall flow of products (it will assume a `STORE` is a more likely final location than a `FARM`, and the reverse for source locations).  In CSV format, it will also limit the final/source locations to a single location each, sorted by timestamp and by the assumption described previously.

# Usage
1) Clone the code locally
2) Nagigate to the top level, and execute:
   - `npm install`
   - `npm run build`
   - `npm run start`
3) From your browser, open http://localhost:5474/ift/api-samples/recall-assistant/v1/swagger/

There is also the option to use our command line interface
1) Clone the code locally
2) Nagigate to the top level, and execute:
   - `npm install`
   - `npm run build`
3) Run either of the following commands to see the parameters available parameters
   - `npm run cli -- -h`
   - `node bin/assistant-cli.js -h`
