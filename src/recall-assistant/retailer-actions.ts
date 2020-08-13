import { config } from '../app';
import * as rp from 'request-promise-native';
import * as _ from 'lodash';

import * as ift_service from './ift-service';

export interface TraceOutput {
  productTraced: ProductInformation;
  inputEpcInfo: ProductInformation[];
  outputEpcInfo: ProductInformation[];
}

export interface ProductInformation {
  epcId: string;
  productName: string;
  productGtin: string;
  eventInfo: EventInfo[];
}

export interface EventInfo {
  bizStep: string;
  eventLocation: string; // location where the event occurred (bizLocation)
  sourceLocation: Location[];
  destinationLocation: Location[];
  eventDate: Date;
  transactions: any;
}

/**
 * result from trace (productTrace) schema
 */
export interface EPC {
  epc_id: string;
  parent_epcs: EPC[];
  input_epcs: EPC[];
  output_epcs: EPC[];
  child_epcs: EPC[];
  events: Event[];
}

export interface Event {
  asset_id: string;
}

export interface Location {
  locationId: string;
  locationName: string;
  locationType: string;
  locationOwner: string;
}

const eventsMap = new Map();
const locationMap = new Map();
const parentAssetMap = {};
let productArray = [];
const transactionsMap = {
  po: new Map(),
  da: new Map(),
  ra: new Map()
};
let productMasterData = [];

/**
 * Scenario 1: Given a product and time range get all the epcs and the related data
 * @param req
 */
export async function getSourceEPCData(req,
  direction: {upstream: boolean, downstream: boolean}
   = { upstream: true, downstream: false }) {
  // 1) get all the epcs by lots_and_serials
  const lotsAndSerials = await ift_service.getProductLotsAndSerials(req);

  // TODO: change the handling to handle a large number of trace calls
  // If the number of lots and serials are greater than 50 (for the moment), ask the user to narrow the
  // search using the date filters
  if (lotsAndSerials && lotsAndSerials.length > 50) {
    return ('Dataset returned is too large. Try narrowing your search using the date filters.');
  } if (!lotsAndSerials || lotsAndSerials.length === 0) {
    return [];
  }

  // 2) trace upstream on all epcs from step 1
  const traceData = await ift_service.runTrace(req, lotsAndSerials, direction);

  // 3) Extract all the assestIDs from all the trace results
  const epcTraceMap = new Map();
  let assets = [];
  if (traceData && traceData.length > 0) {
    traceData.forEach(setOfEvents => {
      assets.push(...processParentAssets(setOfEvents, parentAssetMap));
      const traceMap = ift_service.getEpcEventsMapFromTrace(setOfEvents, parentAssetMap);
      epcTraceMap.set(setOfEvents.epc_id, traceMap);
      assets.push(...getAssetList(traceMap));
    });
  } else { return []; }
  assets = [...new Set(assets)]; // unique array of asset ids

  // 4) get all the events for the assetId's from step 3, where event is aggregation/observation &
  // event end date strictly before the end date provided.
  // Not using the start date as a filter here as the start time at a place of origin or commission can be
  // more than a month earlier as compared to the event that occured at the store)
  // - optional limit on biz_step = "shipping/packing" (too limiting - since biz_steps not the same for all orgs)
  const allEventData = await ift_service.getEvents(req, assets);
  // some events falling outside the date range get filtered out here.

  // Once the event data is fetched, loop through it and create maps for events, locations, products & transactions
  processEventData(allEventData);

  // locationArray = [...new Set(locationArray)];
  productArray = [...new Set(productArray)];

  // 5) Get all location ID's and from event data and call locations api for details
  const locationMasterData = await ift_service.getLocationsData(req, Array.from(locationMap.keys()));

  // update the location map
  locationMasterData.forEach((location) => {
    locationMap.set(location.id, location);
  });

  // 6) Get all product ID's and from event data and call product api for details
  productMasterData = await ift_service.getProductsData(req, productArray);

  // TODO: use a product map to store the data
  // productMasterData.forEach((product) => productMap.set(product.id, product));
  // Cant use the product map here as there are multiple products with the same id.
  // Will loop through the master data object for now

  // 7) Get transactions data for each type (PO/DA/RA)
  const poMasterData = await ift_service.getTransactionsData(req, Array.from(transactionsMap.po.keys()), 'PO');
  poMasterData.forEach((po) => transactionsMap.po.set(po.transaction_id, po));

  const daMasterData = await ift_service.getTransactionsData(req, Array.from(transactionsMap.da.keys()), 'DA');
  daMasterData.forEach((da) => transactionsMap.da.set(da.transaction_id, da));

  const raMasterData = await ift_service.getTransactionsData(req, Array.from(transactionsMap.ra.keys()), 'RA');
  raMasterData.forEach((ra) => transactionsMap.ra.set(ra.transaction_id, ra));

  // get formatted output
  const output = formatOutput(epcTraceMap, direction);
  return output;
}

/**
 * processes the parent EPCs since if a parent EPC shows up twice,
 * it only shows the information once in the product trace, we will
 * create a map to hold the information
 *
 * @param productTrace trace result of the product
 * @param parentAssets map keeping track of parent.epc_id --> associated asset ids/events
 */
export function processParentAssets(productTrace: EPC, parentAssets: {},
  direction: {upstream: boolean, downstream: boolean}
   = { upstream: true, downstream: false }): string[] {
  const assetIDs: string[] = [];
  let children;

  if (direction.upstream) {
    children = productTrace.input_epcs;
  } else {
    children = productTrace.output_epcs;
  }

  if (!!productTrace.parent_epcs && productTrace.parent_epcs.length > 0) {
    productTrace.parent_epcs.forEach(parent => {
      const assets = parentAssets[parent.epc_id] || [];
      assets.push(...parent.events.map((event) => event.asset_id).filter((el) => !!el));

      parentAssets[parent.epc_id] = _.uniq(assets);
      assetIDs.push(...assets);
    });
  }

  // recurse through children of the tree (either input)
  if (!!children && children.length > 0) {
    children.forEach(child => {
      assetIDs.push(...processParentAssets(child, parentAssets));
    });
  }

  return assetIDs;
}

/**
 * Method to return the formatted output
 */
export function formatOutput(epcTraceMap,
  direction: {upstream: boolean, downstream: boolean}
   = { upstream: true, downstream: false }) {
  // form the response array
  const formattedOutputObj = [];
  let productData;
  let inputPData;

  epcTraceMap.forEach(tracedData => {
    const eachTraceOutput: TraceOutput = <TraceOutput>{};
    const prodInfo: ProductInformation = <ProductInformation>{};

    prodInfo.epcId = tracedData.outputs.epc_id;
    const [eventArr, orgId] = getFormattedEventsArray(tracedData.outputs.events);
    // get product Gtin from epc
    const productGtinInfo = ift_service.getProductFromEpc(tracedData.outputs.epc_id);
    const products = productMasterData.filter((product) => {
      return (product.id === productGtinInfo.gtin);
    });

    if (products) {
      if (products.length > 1) {
        // since its possible to have multiple master records for a particular gtin
        // we use the org it to get the correct master data
        // the assumption is that all the events for a particular epc belong to 1 org
        productData = products.find((product) => {
          return (product.org_id === orgId);
        });
      }
      prodInfo.productGtin = (productData && productData.id) || (products[0] && products[0].id);
      prodInfo.productName = (productData && productData.description) || (products[0] && products[0].description);
    }
    prodInfo.eventInfo = eventArr;
    eachTraceOutput.productTraced = prodInfo;

    const inputInfoArray = [];
    // loop through the inputs
    tracedData.inputs.forEach(input => {
      const inputProdInfo: ProductInformation = <ProductInformation>{};
      inputProdInfo.epcId = input.epc_id;
      const [inputEventArr, inputEventOrgId] = getFormattedEventsArray(input.events);
      // get product Gtin from epc
      const inputProductGtinInfo = ift_service.getProductFromEpc(input.epc_id);

      const inputProducts = productMasterData.filter((product) => {
        return (product.id === inputProductGtinInfo.gtin);
      });

      if (inputProducts) {
        if (inputProducts.length > 1) {
          // since its possible to have multiple master records for a particular gtin
          // we use the org it to get the correct master data
          // the assumption is that all the events for a particular epc belong to 1 org
          inputPData = inputProducts.find((product) => {
            return (product.org_id === inputEventOrgId);
          });
        }
        inputProdInfo.productGtin = (inputPData && inputPData.id) || (inputProducts[0] && inputProducts[0].id);
        inputProdInfo.productName = (inputPData && inputPData.description)
          || (inputProducts[0] && inputProducts[0].description);
      }

      inputProdInfo.eventInfo = inputEventArr;
      inputInfoArray.push(inputProdInfo);
    });
    if (direction.upstream) {
      eachTraceOutput.inputEpcInfo = inputInfoArray;
    } else {
      eachTraceOutput.outputEpcInfo = inputInfoArray;
    }
    formattedOutputObj.push(eachTraceOutput);
  });
  return formattedOutputObj;
}

/**
 * Method that will loop through the event data and update a list of maps
 * 1) AssetId to event Map
 * 2) Locations map (without the location master data)
 * 3) Product array (Without the product data)
 * 4) Transactions Map
 */
function processEventData(eventData) {
  eventData.forEach((event) => {
    eventsMap.set(event.asset_id, event);
    const locArr = [
      event['biz_location_id'],
      // event['biz_sub_location_id'],
      ...event['source_location_ids'], // these can be an array of locations
      // ...event['source_sub_location_ids'],
      ...event['destination_location_ids'],
      // ...event['destination_sub_location_ids'],
    ];
    locArr.forEach((location) => locationMap.set(location, undefined)); // default to undefined
    // locationArr = [...locationArr, ...locArr];

    // event.epcs_ids.forEach((epc) => {
    //   if (!epc.includes('sscc')) {
    //     productMap.set(epc, undefined); // default to undefined till we populate with master data
    //   }
    // });

    event.epcs_ids.forEach((epc) => {
      const product = ift_service.getProductFromEpc(epc);
      if (product) {
        productArray.push(product.gtin);
      }
    });
    productArray = [...new Set(productArray)];
    // again default the transaction map data to undefined to be filled later
    event.transaction_ids.forEach((transaction) => {
      if (transaction.type.includes(':po')) {
        transactionsMap.po.set(transaction.id, undefined);
      } else if (transaction.type.includes(':desadv')) {
        transactionsMap.da.set(transaction.id, undefined);
      } else if (transaction.type.includes(':recadv')) {
        transactionsMap.ra.set(transaction.id, undefined);
      }
    });
  });

  // return [locationArr, productArr];
}

/**
 * Method to get all the assetId's from the epcEvents map
 */
function getAssetList(epcEventsMap): string[] {
  const assetIds = [];
  epcEventsMap.outputs.events.forEach(event => {
    assetIds.push(event.asset_id);
  });

  epcEventsMap.inputs.forEach(epcData => {
    epcData.events.forEach(event => {
      assetIds.push(event.asset_id);
    });
  });
  return assetIds;
}

/**
 * Method to get the required location data from the map
 */
function getLocationInfo(locations): Location[] {
  const locArray = [];
  locations.forEach(loc => {
    const locData = locationMap.get(loc);
    if (locData) {
      locArray.push({
        locationId: loc,
        locationName: locData ? locData.party_name : undefined,
        locationType: locData ? locData.party_role_code : undefined,
        locationOwner: locData ? locData.org_id : undefined
      });
    }
  });
  return locArray;
}

/**
 * Method to get the required transaction data from the map
 */
function getTransactionInfo(transactions) {
  const transArray = [];
  transactions.forEach(transaction => {
    if (transaction.type.includes(':po')) {
      transArray.push(transactionsMap.po.get(transaction.id));
    } else if (transaction.type.includes(':desadv')) {
      transArray.push(transactionsMap.da.get(transaction.id));
    } else if (transaction.type.includes(':recadv')) {
      transArray.push(transactionsMap.ra.get(transaction.id));
    }
  });
  return transArray;
}

/**
 * Return a formatted events array
 */
function getFormattedEventsArray(eventList) {
  const eventArr = [];
  let orgId;
  eventList.forEach((event) => {
    const eventInfo = eventsMap.get(event.asset_id);
    if (eventInfo) {
      orgId = eventInfo.org_id;
      // Get the shipping and transaction info
      const bizLocation = locationMap.get(eventInfo.biz_location_id);
      if (eventInfo.event_type === 'commission') { // If commission, display only source location, else display
        eventArr.push({
          bizStep: eventInfo.biz_step,
          eventDate: eventInfo.event_time,
          eventLocation: bizLocation ? bizLocation.party_name : undefined,
          sourceLocation: getLocationInfo(eventInfo.source_location_ids),
          transactions: getTransactionInfo(eventInfo.transaction_ids)
        });
      } else if (!locationEquals(eventInfo.source_location_ids, eventInfo.destination_location_ids)) {
        eventArr.push({
          bizStep: eventInfo.biz_step,
          eventDate: eventInfo.event_time,
          eventLocation: bizLocation ? bizLocation.party_name : undefined,
          sourceLocation: getLocationInfo(eventInfo.source_location_ids),
          destinationLocation: getLocationInfo(eventInfo.destination_location_ids),
          transactions: getTransactionInfo(eventInfo.transaction_ids)
        });
      }
    }
  });
  return [eventArr, orgId];
}

/**
 * Checks equality for two arrays of location ids
 *
 * uses sets: if number of locations is high and order is irrelevant
 * then set logic will be faster
 *
 * @param a First array
 * @param b Second array
 */
function locationEquals(a, b) {
  if (!a || !b) { return false; }
  if (a === b) { return true; }

  if (a.length !== b.length) { return false; }

  const aSet = new Set(a);
  const bSet = new Set(b);

  for (const item of aSet) {
    if (!bSet.has(item)) { return false; }
  }

  return true;

}
