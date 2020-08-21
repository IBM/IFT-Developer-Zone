import { config } from '../app';
import * as rp from 'request-promise-native';
import * as _ from 'lodash';

import * as ift_service from './ift-service';
import * as format from './format';
import {
  processParentAssets as processParentAssets,
  EPC
} from './retailer-actions';

/**
 * very similar to getSourceEPCData
 * small tweaks in function calls, treatment of transactions
 * get all lots and serials associated with product id
 *
 * @param req trace requirements
 *
 * @returns [headers[], content[]]
 */
export async function getIngredientSources(req,
  direction: {upstream: boolean, downstream: boolean}
   = { upstream: true, downstream: false }): Promise<[string[], format.CSVRow[]]> {
  const lotsAndSerials = await ift_service.getProductLotsAndSerials(req);
  if (lotsAndSerials && lotsAndSerials.length > 50) {
    return [
      ['Error: Dataset returned is too large. Try narrowing your search using the date filters.'],
      []
    ];
  } if (!lotsAndSerials || lotsAndSerials.length === 0) {
    return [format.INGREDIENT_CSV_HEADERS, []];
  }

  const traceData = await ift_service.runTrace(req, lotsAndSerials, direction);

  // process event assets and aggregation assets
  let assets = [];
  const aggAssetMap = {};

  if (traceData && traceData.length > 0) {
    traceData.forEach(productTrace => {
      assets.push(...getAssetIDs(productTrace));
    });

    // process parent assets
    traceData.forEach(productTrace => {

      assets.push(...processParentAssets(productTrace, aggAssetMap, direction));
    });
  } else { return [format.INGREDIENT_CSV_HEADERS, []]; }

  assets = _.uniq(assets);

  // get all related event, location, and product information
  const allEventData: any[] = await ift_service.getEvents(req, assets, []);

  const [assetEventMap, locationMap, productArr]: [Map<any, any>, Map<any, any>, any[]]
    = processEventInfo(allEventData);

  const locationMasterData = await ift_service.getLocationsData(req, Array.from(locationMap.keys()));
  const productMasterData = await ift_service.getProductsData(req, productArr);

  locationMasterData.forEach((location) => {
    locationMap.set(location.id, location);
  }); // populate locationMap with information

  // important data used in generating CSVs
  const masterData = {
    events: assetEventMap,
    locations: locationMap,
    products: productMasterData,
    parents: aggAssetMap
  };

  const csv_rows: format.CSVRow[] = [];

  csv_rows.push(...initializeProductCSVRows(traceData, masterData, direction));

  return [
    format.INGREDIENT_CSV_HEADERS,
    csv_rows
  ];

}

/**
 * Similar to getAssetIds from retailer-actions
 * difference in that this captures intermediate EPCs as well
 *
 * @param productTrace trace result of the product
 */
function getAssetIDs(productTrace: EPC) {
  let assetIDs = [];

  if (!!productTrace.events && productTrace.events.length > 0) {
    assetIDs = productTrace.events.map((event) => event.asset_id).filter((el) => !!el);
  }

  if (!!productTrace.input_epcs && productTrace.input_epcs.length > 0) {
    productTrace.input_epcs.forEach(input_product => {
      assetIDs.push(...getAssetIDs(input_product));
    });
  }

  if (!!productTrace.output_epcs && productTrace.output_epcs.length > 0) {
    productTrace.output_epcs.forEach(input_product => {
      assetIDs.push(...getAssetIDs(input_product));
    });
  }

  return assetIDs;
}

/**
 * source: retailer.processEventData
 * difference: ignoring transactions and not utilizing globals
 *
 * @param allEventData object keeping track of all events
 */
function processEventInfo(allEventData: any[]): [Map<any, any>, Map<any, any>, any[]] {
  const assetEventMap = new Map();
  const locationMap = new Map();
  let productArr = [];
  allEventData.forEach((event) => {
    assetEventMap.set(event.asset_id, event);
    const locArr = [
      event['biz_location_id'],
      ...event['source_location_ids'], // these can be an array of locations
      ...event['destination_location_ids'],
    ];
    locArr.forEach((location) => locationMap.set(location, undefined)); // default to undefined

    event.epcs_ids.forEach((epc) => {
      const product = ift_service.getProductFromEpc(epc);
      if (product) {
        productArr.push(product.gtin);
      }
    });
    productArr = _.uniq(productArr);
  });
  return [assetEventMap, locationMap, productArr];
}

/**
 * Populates CSVRow objects based on product information, then sends it
 * to generateIngredientCSVRows to be populated by the respective
 * ingredient information
 *
 * @param productTrace trace of the product
 * @param data masterdata object
 */
function initializeProductCSVRows(productTrace: EPC[], data,
  direction: {upstream: boolean, downstream: boolean}
   = { upstream: true, downstream: false }): format.CSVRow[] {
  const rows: format.CSVRow[] = [];
  productTrace.forEach(trace => {
    const row: format.CSVRow = new format.CSVRow(format.INGREDIENT_CSV_HEADERS);

    row.set(direction.upstream ? format.ALL_HEADERS.finishedProductEPC
                                      : format.ALL_HEADERS.ingredientEPC, trace.epc_id);

    // get event information associated with epc, meanwhile also establish orgId
    let orgId;
    let productData;

    const events = trace.events.map((event) => {
      const eventInfo = data.events.get(event.asset_id);
      if (!!eventInfo) {
        if (!orgId) {
          orgId = eventInfo.org_id;
        }
        return eventInfo;
      }
      return undefined;
    }).filter((el) => !!el);

    // push potential parent epc event data
    trace.parent_epcs.forEach((parent) => {
      events.push(...data.parents[parent.epc_id].map((asset_id) => {
        const eventInfo = data.events.get(asset_id);
        if (!!eventInfo) {
          if (!orgId) {
            orgId = eventInfo.org_id;
          }
          return eventInfo;
        }
        return undefined;
      }).filter((el) => !!el));
    });

    // collect gtin and name information
    const productGtinInfo = ift_service.getProductFromEpc(trace.epc_id);
    const products = data.products.filter((product) => {
      return (product.id === productGtinInfo.gtin);
    });

    if (products) {
      if (products.length > 1) {
        productData = products.find((product) => {
          return (product.org_id === orgId);
        });
      }
      row.set(direction.upstream ? format.ALL_HEADERS.finishedProductGTIN : format.ALL_HEADERS.ingredientGTIN,
        (productData && productData.id) || (products[0] && products[0].id));
      row.set(direction.upstream ? format.ALL_HEADERS.finishedProductName : format.ALL_HEADERS.ingredientName,
        (productData && productData.description) || (products[0] && products[0].description));
    }

    // find latest event, populate row with event data
    const { eventDate, locationId, locationName, locationType }
                    = (direction.upstream ? findFinalLocation : findSourceLocation)(events, data.locations);
    if (direction.upstream) {
      row.set(format.ALL_HEADERS.arrivalDate, eventDate);
      row.set(format.ALL_HEADERS.finalLocationID, locationId);
      row.set(format.ALL_HEADERS.finalLocationName, locationName);
      row.set(format.ALL_HEADERS.finalLocationType, locationType);
    } else if (direction.downstream) {
      row.set(format.ALL_HEADERS.creationDate, eventDate);
      row.set(format.ALL_HEADERS.sourceLocationID, locationId);
      row.set(format.ALL_HEADERS.sourceLocationName, locationName);
      row.set(format.ALL_HEADERS.sourceLocationType, locationType);
    }

    // for each input, create a new CSV row
    const inputRows = [];
    if (direction.upstream) {
      inputRows.push(...populateIngredientCSVRows(row, trace.input_epcs, data, direction));
    } else if (direction.downstream) {
      inputRows.push(...populateIngredientCSVRows(row, trace.output_epcs, data, direction));
    }

    if (inputRows.length === 0) {
      // if there are no inputs, try to find the most upstream location of product
      const {
        eventDate: eDate,
        locationId: locId,
        locationName: locName,
        locationType: locType
      } = (direction.upstream ? findSourceLocation : findFinalLocation)(events, data.locations);

      if (direction.upstream) {
        row.set(format.ALL_HEADERS.creationDate, eDate);
        row.set(format.ALL_HEADERS.sourceLocationID, locId);
        row.set(format.ALL_HEADERS.sourceLocationName, locName);
        row.set(format.ALL_HEADERS.sourceLocationType, locType);
      } else if (direction.downstream) {
        row.set(format.ALL_HEADERS.arrivalDate, eDate);
        row.set(format.ALL_HEADERS.finalLocationID, locId);
        row.set(format.ALL_HEADERS.finalLocationName, locName);
        row.set(format.ALL_HEADERS.finalLocationType, locType);
      }
      rows.push(row);
    } else {
      rows.push(...inputRows);
    }
  });

  return rows;
}

/**
 * Takes the productRow as a template, then populates it with ingredient specific informaiton
 *
 * @param productRow base row with populated information of the product
 * @param productTrace trace of the product
 * @param data masterdata object
 */
function populateIngredientCSVRows(productRow: format.CSVRow,
                                   productTrace: EPC[], data,
                                   direction: {upstream: boolean, downstream: boolean}
                                   = { upstream: true, downstream: false }): format.CSVRow[] {
  const rows: format.CSVRow[] = [];
  productTrace.forEach(trace => {
    const row: format.CSVRow = productRow.copy();

    row.set(direction.upstream ? format.ALL_HEADERS.ingredientEPC
                                         : format.ALL_HEADERS.finishedProductEPC, trace.epc_id);

    // get event information associated with epc, meanwhile also establish orgId
    let orgId;
    let productData;

    const events = trace.events.map((event) => {
      const eventInfo = data.events.get(event.asset_id);
      if (!!eventInfo) {
        if (!orgId) {
          orgId = eventInfo.org_id;
        }
        return eventInfo;
      }
      return undefined;
    }).filter((el) => !!el);

    // push potential parent epc event data
    trace.parent_epcs.forEach((parent) => {
      events.push(...data.parents[parent.epc_id].map((asset_id) => {
        const eventInfo = data.events.get(asset_id);
        if (!!eventInfo) {
          if (!orgId) {
            orgId = eventInfo.org_id;
          }
          return eventInfo;
        }
        return undefined;
      }).filter((el) => !!el));
    });

    // collect gtin and name information
    const productGtinInfo = ift_service.getProductFromEpc(trace.epc_id);
    const products = data.products.filter((product) => {
      return (product.id === productGtinInfo.gtin);
    });

    if (products) {
      if (products.length > 1) {
        productData = products.find((product) => {
          return (product.org_id === orgId);
        });
      }
      row.set(direction.upstream ? format.ALL_HEADERS.ingredientGTIN : format.ALL_HEADERS.finishedProductGTIN,
        (productData && productData.id) || (products[0] && products[0].id));
      row.set(direction.upstream ? format.ALL_HEADERS.ingredientName : format.ALL_HEADERS.finishedProductName,
        (productData && productData.description) || (products[0] && products[0].description));
    }

    // find latest event
    const { eventDate, locationId, locationName, locationType } =
              (direction.upstream ? findSourceLocation : findFinalLocation)(events, data.locations);
    if (direction.upstream) {
      row.set(format.ALL_HEADERS.creationDate, eventDate);
      row.set(format.ALL_HEADERS.sourceLocationID, locationId);
      row.set(format.ALL_HEADERS.sourceLocationName, locationName);
      row.set(format.ALL_HEADERS.sourceLocationType, locationType);
    } else if (direction.downstream) {
      row.set(format.ALL_HEADERS.arrivalDate, eventDate);
      row.set(format.ALL_HEADERS.finalLocationID, locationId);
      row.set(format.ALL_HEADERS.finalLocationName, locationName);
      row.set(format.ALL_HEADERS.finalLocationType, locationType);
    }

    rows.push(row);

    // recurse up tree
    if (direction.upstream) {
      rows.push(...populateIngredientCSVRows(productRow, trace.input_epcs, data, direction));
    }

    if (direction.downstream) {
      rows.push(...populateIngredientCSVRows(productRow, trace.output_epcs, data, direction));
    }

  });

  return rows;
}

/**
 * Selects a final location for an EPC based on its events and the event type
 * based on: retailer.getLocationInfo
 *
 * @param events list of events
 * @param locationMap master location data mapping location id to location data
 */
function findFinalLocation(events, locationMap): { eventDate, locationId, locationName, locationType } {
  if (!events || events.length === 0) {
    return {
      eventDate: null,
      locationId: null,
      locationName: null,
      locationType: null
    };
  }

  const tieBreaker = [
    'BREEDER',
    'FARMER',
    'GROWER',
    'FARM',
    'SUPPLIER',
    'DISTRIBUTION_CENTER',
    'STORE',
  ];

  // determine latest event
  const finalEvent = events.reduce((event1, event2) => {
    const event_time1 = new Date(event1.event_time);
    const event_time2 = new Date(event2.event_time);

    return (event_time1 > event_time2) ? event1 : event2;
  });

  // determine final location from latest event
  const finalLocation = [finalEvent.biz_location_id,
  ...finalEvent.destination_location_ids].map((location) => { // map location ids to location information
    const locData = locationMap.get(location);
    return {
      eventDate: finalEvent.event_time,
      locationId: location,
      locationName: locData ? locData.party_name : undefined,
      locationType: locData ? locData.party_role_code : undefined
    };
  }).reduce((loc1, loc2) => { // reduce to a single location
    const ind1 = tieBreaker.indexOf(loc1.locationType);
    const ind2 = tieBreaker.indexOf(loc2.locationType);
    return (ind1 > ind2) ? loc1 : loc2;
  });

  return finalLocation;
}

/**
 * Selects a source location for an EPC based on its events and the event type
 * based on: retailer.getLocationInfo
 *
 * @param events list of events
 * @param locationMap master location data mapping location id to location data
 */
function findSourceLocation(events, locationMap) {
  if (!events || events.length === 0) {
    return {
      eventDate: null,
      locationId: null,
      locationName: null,
      locationType: null
    };
  }

  const locTieBreaker = [
    'STORE',
    'DISTRIBUTION_CENTER',
    'SUPPLIER',
    'FARM',
    'FARMER',
    'GROWER',
    'BREEDER',
  ];
  const eventTieBreaker = ['aggregation', 'observation', 'commission'];

  // determine source event
  const firstEvent = events.reduce((event1, event2) => {
    const event_time1 = new Date(event1.event_time);
    const event_time2 = new Date(event2.event_time);
    if (event_time1 < event_time2) {
      return event1;
    } if (event_time1 > event_time2) {
      return event2;
    }
    // evaluate on an index using event tiebreaker values.
    const ind1 = eventTieBreaker.indexOf(event1.event_type);
    const ind2 = eventTieBreaker.indexOf(event2.event_type);
    return (ind1 > ind2) ? event1 : event2;
  });

  // determine source location from source event
  const sourceLocation = [firstEvent.biz_location_id,
  ...firstEvent.source_location_ids].map((location) => { // map location ids to location information
    const locData = locationMap.get(location);
    return {
      eventDate: firstEvent.event_time,
      locationId: location,
      locationName: locData ? locData.party_name : undefined,
      locationType: locData ? locData.party_role_code : undefined
    };
  }).reduce((loc1, loc2) => { // reduce to a single location
    // evaluate on an index using location tiebreaker values.
    const ind1 = locTieBreaker.indexOf(loc1.locationType);
    const ind2 = locTieBreaker.indexOf(loc2.locationType);
    return (ind1 > ind2) ? loc1 : loc2;
  });

  return sourceLocation;
}
