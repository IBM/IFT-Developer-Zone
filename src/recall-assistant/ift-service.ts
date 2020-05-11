import { config } from '../app';
import * as rp from 'request-promise-native';
import * as _ from 'lodash';

export const constants = {
  // Depth of trace
  DEPTH: 30,
  // Pagination limit to be used for trace apis
  PAGE_SIZE: 30,
  // URN for GS1 standard SGLN
  URN_GS1_SGLN: 'urn:epc:id:sgln:',
  // URN for GS1 standard SGTIN
  URN_GS1_SGTIN: 'urn:epc:id:sgtin:',
  // URN for IFT standard SGTIN
  URN_IFT_SGTIN: 'urn:ibm:ift:product:serial:obj:',
  // URN for GS1 SGTIN without no lots
  URN_PAT_SGTIN: 'urn:epc:idpat:sgtin:',
  // URN for GS1 standard LGTIN
  URN_GS1_LGTIN: 'urn:epc:class:lgtin:',
  // URN for IFT standard LGTIN
  URN_IFT_LGTIN: 'urn:ibm:ift:product:lot:class:',
  // URN for IFT GTIN
  URN_IFT_GTIN: 'urn:ibm:ift:product:class:',
};

// Helper method to take constraints and build parameters for the trace URL
export function getTraceRestraintParameters(location_id: string,
                                     product_id: string[],
                                     event_start_timestamp: string,
                                     event_end_timestamp: string) {
  // Handle encoding for array inputs elements ahead of time
  const productIds: string[] = [];
  if (product_id && Array.isArray(product_id) && product_id.length > 0) {
    product_id.forEach(id => productIds.push(encodeURIComponent(id)));
  }
  const traceCallUriParams = `${location_id ? `&location_id[]=${encodeURIComponent(location_id)}` : ''}${
                                productIds && productIds.length > 0 ?
                                `&product_id[]=${productIds.join('&product_id[]=')}` : ''}${
                                event_start_timestamp ? `&event_start_timestamp=${event_start_timestamp}` : ''}${
                                event_end_timestamp ? `&event_end_timestamp=${event_end_timestamp}` : ''}`;
  return traceCallUriParams;
}

// Find EPCs commissioned at a particular location for particular products within a time range
export async function getEpcs(req) {
  const traceRestraintParameters = getTraceRestraintParameters(req.query.location_id,
                                                               req.query.product_id,
                                                               req.query.event_start_timestamp,
                                                               req.query.event_end_timestamp);
  const traceCallUri = `${config.ift_url}/events?event_type[]=commission${traceRestraintParameters}`;
  console.info(`Trace call to get harvested EPCs: ${traceCallUri}`);
  /* Example: "https://food.ibm.com/ift/api/outbound/v2/events?event_type[]=commission&location_id[]=urn
     %3Aibm%3Aift%3Alocation%3Aloc%3A1953084565871.PMA_Salinas&product_id[]=urn%3Aibm%3Aift%3Aproduct%3A
     class%3A1953084565871.pFOa&product_id[]=urn%3Aibm%3Aift%3Aproduct%3Aclass%3A1953084565871.APJj&
     event_start_timestamp=2019-11-15&event_end_timestamp=2019-11-30" */
  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: traceCallUri,
    method: 'GET',
  };
  // Issue request to the trace API
  return rp(options).then((traceResponse: any) => {
    const eventsObj = JSON.parse(traceResponse);
    // Get a list of all unique EPCs referenced in the matching events
    let epcs: string[] = [];
    eventsObj.events.forEach((event) => {
      epcs = _.union(epcs, event.epcs_ids.filter((epc) => !epc.includes('sscc')));
    });
    return epcs;
  }).catch((err) => {
    console.error(`Error getting EPCs from commission events: ${err}`);
    throw err;
  });
}

// Find EPCs that the input EPCs were transformed into
export async function getTransformOutputEpcs(req, inputEpcs: string[]) {
  const epcIds: string[] = [];
  const eventsPromiseList = [];
  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: '',
    method: 'GET',
  };
  let pagedEPC: string[] = [];

  if (inputEpcs && Array.isArray(inputEpcs) && inputEpcs.length > 0) {
    inputEpcs.forEach(id => {
      // Note: We might want to include pallets, but we dont really expect pallets to be commissioned
      // without knowing the contents and cant check them for products, so ignoring
      if (!id.includes('sscc')) {
        epcIds.push(encodeURIComponent(id));
      }
    });

    // loop through the epcs 30 or PAGE_SIZE at a time and make the event api calls
    while (epcIds.length > 0) {
      pagedEPC = epcIds.splice(0, constants.PAGE_SIZE);
      // form the URL and make the calls
      const eventCallUriParamWithEPC = `${pagedEPC && pagedEPC.length > 0 ? `&epc_id[]=${pagedEPC.join('&epc_id[]=')}` : ''}`;
      const eventsCallUri = `${config.ift_url}/events?event_type[]=transformation${eventCallUriParamWithEPC}`;
      console.info(`Trace call to get tranformations from impacted EPCs: ${eventsCallUri}`);
      /* Example: https://food.ibm.com/ift/api/outbound/v2/events?event_type[]=transformation&event_start_timestamp=
         2019-11-15&epc_id[]=urn%3Aibm%3Aift%3Aproduct%3Alot%3Aclass%3A1953084565871.APJj.2322&epc_id[]=urn%3Aibm%3A
         ift%3Aproduct%3Alot%3Aclass%3A1953084565871.pFOa.2131212 */
      options.uri = eventsCallUri;
      // Issue request to the trace API and add to an array of promises
      eventsPromiseList.push(rp(options));
    }
  }

  const epcs = await processPromiseList(eventsPromiseList, 'transformation');
  return epcs;
}

// Find all aggregations where the input EPCs are children, and return referenced transactions
export async function getTransactions(req, inputEpcs: string[]) {
  let pagedEPC: string[] = [];
  const epcIds: string[] = [];
  const eventsPromiseList = [];
  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: '',
    method: 'GET',
  };
  if (inputEpcs && Array.isArray(inputEpcs) && inputEpcs.length > 0) {
    inputEpcs.forEach(id => {
      // Note: We might want to include pallets, but we dont really expect pallets to be commissioned
      // without knowing the contents and cant check them for products, so ignoring
      if (!id.includes('sscc')) {
        epcIds.push(encodeURIComponent(id));
      }
    });

    // loop through the epcs 30 or PAGE_SIZE at a time
    while (epcIds.length > 0) {
      pagedEPC = epcIds.splice(0, constants.PAGE_SIZE);

      // form the URL and make the calls
      const eventCallUriParamWithEPC = `${pagedEPC && pagedEPC.length > 0 ? `&epc_id[]=${pagedEPC.join('&epc_id[]=')}` : ''}`;
      const eventCallUri = `${config.ift_url}/events?event_type[]=aggregation${eventCallUriParamWithEPC}`;
      console.info(`Trace call to get transactions from impacted EPCs: ${eventCallUri}`);
      /* Example: "https://food.ibm.com/ift/api/outbound/v2/events?event_type[]=aggregation&event_start_timestamp=
         2019-11-15&epc_id[]=urn%3Aibm%3Aift%3Aproduct%3Alot%3Aclass%3A1953084565871.APJj.2322&epc_id[]=urn%3Aibm%3
         Aift%3Aproduct%3Alot%3Aclass%3A1953084565871.pFOa.2131212&epc_id[]=urn%3Aibm%3Aift%3Aproduct%3Alot%3Aclass
         %3A1953084565871.OdCD.475" */

      options.uri = eventCallUri;
      // Issue request to the trace API and save in an array of promises
      eventsPromiseList.push(rp(options));
    }
  }

  const transactionIds = await processPromiseList(eventsPromiseList, 'aggregation');
  return transactionIds;
}

export async function processPromiseList(promiseList: string[], eventType: string) {
  return Promise.all(promiseList).then((eventResponse: any) => {
    let ids: string[] = []; // Get a list of all EPCs listed as outputs on these tranformations or transactionIds
    eventResponse.forEach((response) => {
      const eventsObj = JSON.parse(response);
      eventsObj.events.forEach((event) => {
        if (eventType === 'aggregation') {
          // Loop through transactions on each event to get ids
          event.transaction_ids.forEach((transaction) => {
            ids = [...ids, transaction.id];
          });
        } else if (eventType === 'transformation') {
          event.output_quantities.forEach((output) => {
            ids = [...ids, output.epc_id];
          });
        }
      });
    });
    return (ids && ids.length) > 0 ? _.uniq(ids) : [];
  }).catch((err) => {
    console.error(`Error getting EPCs from relevant events: ${err}`);
    throw err;
  });

}

// Find all EPCs (lots and serials) commissioned for particular product
export async function getProductLotsAndSerials(req) {
  const restraintParameters = getTraceRestraintParameters('',
                                                          req.query.product_id,
                                                          req.query.event_start_timestamp,
                                                          req.query.event_end_timestamp);
  const lotsAndSerialsCallUri = `${config.ift_url}/lots_and_serials?limit=500&${restraintParameters}`;
  console.info(`Trace call to get product lots and serial EPCs: ${lotsAndSerialsCallUri}`);

  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: lotsAndSerialsCallUri,
    method: 'GET',
  };
  // Issue request to the trace API
  return rp(options).then((response: any) => {
    const epcRespObj = JSON.parse(response);
    // Get a list of all unique EPCs referenced in the matching events
    const epcs: string[] = epcRespObj.lots_and_serials.reduce((epcArry, currentValue) => {
      return [...epcArry, currentValue.id];
    }, []);
    return epcs;
  }).catch((err) => {
    console.error(`Error getting EPCs from commission events: ${err}`);
    throw err;
  });
}

// Get all the aggregation/observation events for given lots and serials
// TODO: make it more generic to support other types
export async function getEvents(req, inputAssetIds: string[], bizStep?: string[]) {
  let pagedAssets: string[] = [];
  const eventsData: string[] = [];
  const eventsPromiseList = [];
  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: '',
    method: 'GET',
  };

  if (inputAssetIds && Array.isArray(inputAssetIds) && inputAssetIds.length > 0) {
    // loop through the assetids 30 or PAGE_SIZE at a time
    while (inputAssetIds.length > 0) {
      pagedAssets = inputAssetIds.splice(0, constants.PAGE_SIZE);
      // form the URL and make the calls
      const eventCallUriParamWithAssets = `${pagedAssets && pagedAssets.length > 0
        ? `&asset_id[]=${pagedAssets.join('&asset_id[]=')}` : ''}`;
      // optional biz_step
      const eventBizStep = `${bizStep && bizStep.length > 0
        ? `&biz_step[]=${bizStep.join('&biz_step[]=')}` : ''}`;
      // filter by event_end_timestamp so that you dont get events past the date searched for
      // const eventEndTimeParams = getTraceRestraintParameters('', [], '', req.query.event_end_timestamp);
      const eventEndTimeParams = '';
      const eventCallUri = `${config.ift_url}/events?event_type[]=aggregation&event_type[]=observation${
        eventCallUriParamWithAssets}${eventBizStep}${eventEndTimeParams}`;
      console.info(`Trace call to get all events from asset ids: ${eventCallUri}`);

      options.uri = eventCallUri;
      // Issue request to the trace API and save in an array of promises
      eventsPromiseList.push(rp(options));
    }
  }

  return Promise.all(eventsPromiseList).then((eventResponse: any) => {
    eventResponse.forEach((response) => {
      const eventsObj = JSON.parse(response);
      eventsData.push(...eventsObj.events);
    });
    return eventsData;
  }).catch((err) => {
    console.error(`Error getting events from asset IDs: ${err}`);
    throw err;
  });
}

// Run a trace on all EPC's and return the asset id's
export async function runTrace(req, inputEPCs: string[], upstream = false, downstream = false) {
  const tracePromiseList = [];
  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: '',
    method: 'GET',
  };
  if (inputEPCs && inputEPCs.length > 0) {
    inputEPCs.forEach(epcId => {
      // foreach EPC trace upstream
      const traceUri = `${config.ift_url}/epcs/${epcId}/trace?depth=${constants.DEPTH}${
        upstream ? `&upstream=true` : ''}${
        downstream ? `&downstream=true` : ''}`;
      console.info(`Trace call to get the EPC/trace: ${traceUri}`);

      options.uri = traceUri;
      // Issue request to the trace API and save in an array of promises
      tracePromiseList.push(rp(options));
    });

    return Promise.all(tracePromiseList).then((traceResponse: any) => {
      const traceResults = [];
      traceResponse.forEach((response) => {
        const traceObj = JSON.parse(response);
        traceResults.push(traceObj.trace);
      });
      return traceResults;
    }).catch((err) => {
      console.error(`Error tracing on epcs: ${err}`);
      throw err;
    });
  }
}

/**
 * Method to call location API to fetch location data
 */
export async function getLocationsData(req, locationIds) {
  let locations: string[] = [];
  const promiseList = [];
  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: '',
    method: 'GET',
  };

  if (locationIds && locationIds.length > 0) {
    // loop through the locationIds 30 or PAGE_SIZE at a time
    while (locationIds.length > 0) {
      locations = locationIds.splice(0, constants.PAGE_SIZE);
      // form the URL and make the calls
      const locationsUri = `${config.ift_url}/locations?${locations && locations.length > 0
        ? `location_id[]=${locations.join('&location_id[]=')}` : ''}`;
      console.info(`Trace call to get location data: ${locationsUri}`);

      options.uri = locationsUri;
      // Issue request to the trace API and save in an array of promises
      promiseList.push(rp(options));
    }
  }

  return Promise.all(promiseList).then((response: any) => {
    const locationData = [];
    response.forEach((data) => {
      const locationsObj = JSON.parse(data);
      locationData.push(...locationsObj.locations);
    });
    return locationData;
  }).catch((err) => {
    console.error(`Error getting locations: ${err}`);
    throw err;
  });
}

/**
 * Method to call the Products API and fetch product information
 */
export async function getProductsData(req, producIds) {
  let products: string[] = [];
  const promiseList = [];
  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: '',
    method: 'GET',
  };

  if (producIds && Array.isArray(producIds) && producIds.length > 0) {
    // loop through the productIds 30 or PAGE_SIZE at a time
    while (producIds.length > 0) {
      products = producIds.splice(0, constants.PAGE_SIZE);
      // form the URL and make the calls
      const productUri = `${config.ift_url}/products?${products && products.length > 0
        ? `product_id[]=${products.join('&product_id=')}` : ''}`;
      console.info(`Trace call to get product data: ${productUri}`);

      // Used for epcs with special chars in it like '+', but it doesnt work
      // options.uri = encodeURIComponent(productUri);
      options.uri = productUri;
      // Issue request to the trace API and save in an array of promises
      promiseList.push(rp(options));
    }
  }

  return Promise.all(promiseList).then((response: any) => {
    const productData = [];
    response.forEach((data) => {
      const productsObj = JSON.parse(data);
      productData.push(...productsObj.products);
    });
    return productData;
  }).catch((err) => {
    console.error(`Error getting product info: ${err}`);
    throw err;
  });
}

// Method to get all the epcEvent mapping from the traced response
export function getEpcEventsMapFromTrace(traceResponse): {} {
  const epcEventMap = { outputs: {} , inputs: [{}] };
  epcEventMap.outputs = {
    epc_id : traceResponse.epc_id,
    // events: traceResponse.events
    events: traceResponse.events.filter((event) => {
      return (event.asset_id.includes('observation') || event.asset_id.includes('aggregation'));
    })
  };
  epcEventMap.inputs = this.getUpstreamEventsAndEPCs(traceResponse.input_epcs);
  return epcEventMap;
}

// Recursively loop through the EPC tree to get all events
export function getUpstreamEventsAndEPCs(epcs) {
  if (epcs === undefined || !epcs.length) {
    return [];
  }

  return epcs.reduce((allEvents, epc) => { // foreach in the list do the following
    if (epc.input_epcs.length > 0) {
      // if there exist input epcs, traverse further in the tree
      allEvents.push(...this.getUpstreamEventsAndEPCs(epc.input_epcs));
    } else {
      // if there are no more inputs, return the edge events
      allEvents.push({
        epc_id : epc.epc_id,
        // events: epc.events
        events: epc.events.filter((event) => {
          return (event.asset_id.includes('observation') || event.asset_id.includes('aggregation'));
        })
      });
    }
    return allEvents;
  }, []);
}

// Method to call purchase order transactions API to fetch transaction data
export async function getTransactionsData(req, trasactionIds, type) {
  if (!trasactionIds || !type) {
    return; // return if no type or transaction list is passed.
  }

  let transactions: string[] = [];
  const promiseList = [];
  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: '',
    method: 'GET',
  };

  if (trasactionIds && Array.isArray(trasactionIds) && trasactionIds.length > 0) {
    // loop through the locationIds 30 or PAGE_SIZE at a time
    while (trasactionIds.length > 0) {
      transactions = trasactionIds.splice(0, constants.PAGE_SIZE);
      // form the URL and make the calls
      const transactionsUri = `${config.ift_url}/transactions/${
      type && type === 'PO' ? 'purchase_orders' : type === 'DA' ? 'despatch_advices' : type === 'RA' ? 'receive_advices' : '' }?${
      transactions && transactions.length > 0 ? `transaction_id[]=${transactions.join('&transaction_id[]=')}` : ''}`;
      console.info(`Trace call to get transaction PO data: ${transactionsUri}`);

      options.uri = transactionsUri;
      // Issue request to the trace API and save in an array of promises
      promiseList.push(rp(options));
    }
  }

  return Promise.all(promiseList).then((response: any) => {
    const transactionData = [];
    response.forEach((data) => {
      const dataObj = JSON.parse(data);
      if (type === 'po') {
        transactionData.push(...dataObj.purchase_orders);
      } else if (type === 'po') {
        transactionData.push(...dataObj.despatch_advices);
      } else if (type === 'po') {
        transactionData.push(...dataObj.receive_advices);
      }
    });
    return transactionData;
  }).catch((err) => {
    console.error(`Error getting transaction data: ${err}`);
    return []; // return for now (since there are cases for invalid transaction ids)
  });
}

// get LGTIN using epcClass
export function getLGTIN(epc: any): { gtin: string, lotOrSerialNo: string, valid: boolean } {
  let epcClass;
  let subProductNo1;
  let subProductNo2;
  let partialGTIN;
  let gtin;
  let lot;

  // handle IBM-issued (non-GS1)
  if (epc && epc.indexOf(constants.URN_IFT_LGTIN) >= 0) {  // IFT ID
    epcClass = explode(epc, constants.URN_IFT_LGTIN);
    subProductNo1 = explode(epcClass, '.', 0);
    subProductNo2 = explode(epcClass, '.', 1);
    gtin = `${constants.URN_IFT_GTIN}${subProductNo1}.${subProductNo2}`;
    lot = explode(epcClass, '.', 2);
  } else if (epc && epc.indexOf(constants.URN_GS1_LGTIN) >= 0) {  // GS1 ID
    epcClass = explode(epc, constants.URN_GS1_LGTIN);
    subProductNo1 = explode(epcClass, '.', 0);
    subProductNo2 = explode(epcClass, '.', 1);
    partialGTIN =
      `${subProductNo2.substring(0, 1)}${subProductNo1}${subProductNo2.substring(1, subProductNo2.length)}`;
    const lastDigit = calcCheckDigit(partialGTIN);
    gtin = `${partialGTIN}${lastDigit}`;
    lot = explode(epcClass, '.', 2);
  } else {
    return {
      gtin: '',
      lotOrSerialNo: '',
      valid: false,
    };
  }

  return {
    gtin,
    lotOrSerialNo: lot,
    valid: true,
  };
}

// gets serials and gtin from SGTIN using epcList
// @param epc array of SGTINs in epcList
export function getSGTIN(epc: any): { gtin: string, lotOrSerialNo: string, valid: boolean } {
  let epcClass;
  let subProductNo1;
  let subProductNo2;
  let partialGTIN;
  let gtin;
  let serialNo;

  if (epc && epc.indexOf(constants.URN_GS1_SGTIN) >= 0) {  // GS1 ID
    epcClass = explode(epc, constants.URN_GS1_SGTIN);
    subProductNo1 = explode(epcClass, '.', 0);
    subProductNo2 = explode(epcClass, '.', 1);
    partialGTIN =
      `${subProductNo2.substring(0, 1)}${subProductNo1}${subProductNo2.substring(1, subProductNo2.length)}`;
    const lastDigit = calcCheckDigit(partialGTIN);
    gtin = `${partialGTIN}${lastDigit}`;
    serialNo = explode(epcClass, '.', 2);
  } else if (epc && epc.indexOf(constants.URN_IFT_SGTIN) >= 0) {  // IFT ID
    epcClass = explode(epc, constants.URN_IFT_SGTIN);
    subProductNo1 = explode(epcClass, '.', 0);
    subProductNo2 = explode(epcClass, '.', 1);
    gtin = `${constants.URN_IFT_GTIN}${subProductNo1}.${subProductNo2}`;
    serialNo = explode(epcClass, '.', 2);
  } else if (epc && epc.indexOf(constants.URN_PAT_SGTIN) >= 0) { // SGTIN w/o serial
    epcClass = explode(epc, constants.URN_PAT_SGTIN);
    subProductNo1 = explode(epcClass, '.', 0);
    subProductNo2 = explode(epcClass, '.', 1);
    partialGTIN =
      `${subProductNo2.substring(0, 1)}${subProductNo1}${subProductNo2.substring(1, subProductNo2.length)}`;
    const lastDigit = calcCheckDigit(partialGTIN);
    gtin = `${partialGTIN}${lastDigit}`;
    serialNo = '';
  } else {
    return {
      gtin: '',
      lotOrSerialNo: '',
      valid: false,
    };
  }

  return {
    gtin,
    lotOrSerialNo: serialNo,
    valid: true,
  };
}

// custom string explode function
export function explode(input: string, separator: string, index?: number): string {
  if (input !== 'undefined') {
    if (typeof index !== 'undefined' && index !== null) {
      return (input.split(separator)[index] !== undefined)
        ? input.split(separator)[index].replace(/\s+/, '')
        : input;
    }
    return input.split(separator).join(' ');
  }
  return '';
}

// check digit formula
function calcCheckDigit(s: string): number {
  let result = 0;
  const rs = s.split('').reverse().join('');

  for (let counter = 0; counter < rs.length; counter += 1) {
    result = result + parseInt(rs.charAt(counter), 10) * Math.pow(3, ((counter + 1) % 2));
  }
  return (10 - (result % 10)) % 10;
}
