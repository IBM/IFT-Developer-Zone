import { config } from '../app';
import * as rp from 'request-promise-native';
import * as _ from 'lodash';

export const constants = {
  // Depth of trace
  DEPTH: 30,
  // Pagination limit to be used for trace APIs
  PAGE_SIZE: 20,
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
export function getTraceConstraintParameters(location_id: string,
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

/**
 * Splits rp call into pages by constants.PAGE_SIZE
 * and returns the entire list as one
 *
 * @param options options for rp call
 * @param traceParameters parameters for call to IFT API
 * @param pageURI function that produces the URI for each page
 */
function paginate_rp(options,
                     traceParameters: any[],
                     pageURI: Function,
                     pageSize: number = constants.PAGE_SIZE): Promise<any> {
  const promiseList = [];
  const params = [...traceParameters];
  // loop through the epcs 30 or PAGE_SIZE at a time and make the event api calls
  while (params.length > 0) {
    const pagedParams = params.splice(0, pageSize);
    const callURI = pageURI(pagedParams);
    options.uri = callURI;

    // Issue request to the trace API and add to an array of promises
    promiseList.push(rp(options));
  }

  // Parse JSON response
  return Promise.all(promiseList).then((responses: any[]) => {
    return responses.map(response => JSON.parse(response));
  }).catch((err) => {
    console.error(`Error getting EPCs from relevant events: ${err}`);
    throw err;
  });
}

// Find EPCs commissioned at a particular location for particular products within a time range
export async function getEpcs(req) {
  const traceRestraintParameters = getTraceConstraintParameters(req.query.location_id,
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
      epcs = _.union(epcs, event.epcs_ids.filter((epc) => {
        // check to make sure it is a valid EPC (lot, serial, or pallet)
        return !epc.includes('sscc')
          && RegExp(/(urn:(?:epc|ibm):[^:]*:(?:sgln|lgtin|sgtin|product:(?:lot|serial)|lpn:obj))/gm).test(epc);
      }));
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
  const eventsList = [];
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

    eventsList.push(...await paginate_rp(options, epcIds, (pagedEPC) => {
      const eventCallUriParamWithEPC = `${pagedEPC && pagedEPC.length > 0 ? `&epc_id[]=${pagedEPC.join('&epc_id[]=')}` : ''}`;
      const eventsCallUri = `${config.ift_url}/events?event_type[]=transformation${eventCallUriParamWithEPC}`;
      console.info(`Trace call to get tranformations from impacted EPCs: ${eventsCallUri}`);
      /* Example: https://food.ibm.com/ift/api/outbound/v2/events?event_type[]=transformation&event_start_timestamp=
          2019-11-15&epc_id[]=urn%3Aibm%3Aift%3Aproduct%3Alot%3Aclass%3A1953084565871.APJj.2322&epc_id[]=urn%3Aibm%3A
          ift%3Aproduct%3Alot%3Aclass%3A1953084565871.pFOa.2131212 */
      return eventsCallUri;
    }));
  }

  const epcs = processResponse(eventsList, 'transformation');
  return epcs;
}

// Find all aggregations where the input EPCs are children, and return referenced transactions
export async function getTransactions(req, inputEpcs: string[]) {
  const epcIds: string[] = [];
  const eventsList = [];
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

    eventsList.push(...await paginate_rp(options, epcIds, (pagedEPC) => {
      // form the URL and make the calls
      const eventCallUriParamWithEPC = `${pagedEPC && pagedEPC.length > 0 ? `&epc_id[]=${pagedEPC.join('&epc_id[]=')}` : ''}`;
      const eventCallUri = `${config.ift_url}/events?event_type[]=aggregation${eventCallUriParamWithEPC}`;
      console.info(`Trace call to get transactions from impacted EPCs: ${eventCallUri}`);
      /* Example: "https://food.ibm.com/ift/api/outbound/v2/events?event_type[]=aggregation&event_start_timestamp=
         2019-11-15&epc_id[]=urn%3Aibm%3Aift%3Aproduct%3Alot%3Aclass%3A1953084565871.APJj.2322&epc_id[]=urn%3Aibm%3
         Aift%3Aproduct%3Alot%3Aclass%3A1953084565871.pFOa.2131212&epc_id[]=urn%3Aibm%3Aift%3Aproduct%3Alot%3Aclass
         %3A1953084565871.OdCD.475" */
      return eventCallUri;
    }));
  }

  const transactionIds = processResponse(eventsList, 'aggregation');
  return transactionIds;
}

export function processResponse(responseList: any[], eventType: string) {
  let response: any[] = []; // Get a list of all EPCs listed as outputs on these tranformations or transactionIds
  responseList.forEach((responseJSON: any) => {
    responseJSON.events.forEach((event) => {
      if (eventType === 'aggregation') {
        // handle transaction events:
        for (const transaction of event.transaction_ids) {
          const res = {
            id: transaction['id'],
            type: transaction['type'],
            epc_ids: event.epcs_ids,
            event_time: event.event_time
          };
          response.push(res);
        }
      } else if (eventType === 'transformation') {
        event.output_quantities.forEach((output) => {
          response = [...response, output.epc_id];
        });
      }
    });
    // NOTE: Works but might be (ids && ids.length > 0) or even just (ids && ids.length).
    // NOTE: Modified for more clarity
  });
  return (response && response.length > 0) ? _.uniq(response) : [];

}

// Find all EPCs (lots and serials) commissioned for particular product
export async function getProductLotsAndSerials(req) {
  const restraintParameters = getTraceConstraintParameters('',
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
export async function getEvents(req, inputAssetIds: string[], eventTypes: string[]= ['commission', 'aggregation', 'observation'], bizSteps?: string[]) {
  const eventsList = [];
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
    eventsList.push(...await paginate_rp(options, inputAssetIds, (pagedAssets) => {
      // form the URL and make the calls
      const eventCallUriParamWithAssets = `${pagedAssets && pagedAssets.length > 0
        ? `&asset_id[]=${pagedAssets.join('&asset_id[]=')}` : ''}`;
      // optional biz_step
      const eventBizStep = `${bizSteps && bizSteps.length > 0
        ? `&biz_step[]=${bizSteps.join('&biz_step[]=')}` : ''}`;
      // filter by event_end_timestamp so that you dont get events past the date searched for
      // const eventEndTimeParams = getTraceConstraintParameters('', [], '', req.query.event_end_timestamp);
      // Since we want to filter by commission time, no need to filter by event_end_timestamp here
      const eventEndTimeParams = '';
      const eventCallUri = `${config.ift_url}/events?${(!(eventTypes && eventTypes.length)) ? '' : `event_type[]=${eventTypes.join('&event_type[]=')}`}${
        eventCallUriParamWithAssets}${eventBizStep}${eventEndTimeParams}`;
      console.info(`Trace call to get all events from asset ids: ${eventCallUri}`);

      return eventCallUri;
    }));
  }

  return (!(eventsList && eventsList.length > 0)) ? [] : eventsList.map((responseJSON) => responseJSON.events)
                                                                   .reduce((arr1, arr2) => [...arr1, ...arr2]);
}

// Run a trace on all EPC's and return the asset id's
export async function runTrace(req,
  inputEPCs: string[],
  traceOptions: {upstream: boolean, downstream: boolean} = { upstream: false, downstream: false }) {
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
        traceOptions.upstream ? `&upstream=true` : ''}${
          traceOptions.downstream ? `&downstream=true` : ''}`;
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
export async function getLocationsData(req, locationIds: any[]) {
  const locations: any[] = [];
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

    locations.push(...await paginate_rp(options, locationIds, (pagedLocations) => {
      // form the URL and make the calls
      const locationsUri = `${config.ift_url}/locations?${pagedLocations && pagedLocations.length > 0
        ? `location_id[]=${pagedLocations.join('&location_id[]=')}` : ''}`;
      console.info(`Trace call to get location data: ${locationsUri}`);

      return locationsUri;
    }));
  }

  return (!(locations && locations.length)) ? [] : locations.map((responseJSON) => responseJSON.locations)
                                                            .reduce((arr1, arr2) => [...arr1, ...arr2]);
}

/**
 * Method to call the Products API and fetch product information
 */
export async function getProductsData(req, productIds) {
  const products: any[] = [];
  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: '',
    method: 'GET',
  };

  if (productIds && Array.isArray(productIds) && productIds.length > 0) {
    // loop through the productIds 30 or PAGE_SIZE at a time

    products.push(...await paginate_rp(options, productIds, (pagedProducts) => {
      // form the URL and make the calls
      const productUri = `${config.ift_url}/products?${pagedProducts && pagedProducts.length > 0
        ? `product_id[]=${pagedProducts.join('&product_id=')}` : ''}`;
      console.info(`Trace call to get product data: ${productUri}`);

      // Used for epcs with special chars in it like '+', but it doesnt work
      // options.uri = encodeURIComponent(productUri);
      return productUri;
    }));
  }
  return (!(products && products.length)) ? [] : products.map((responseJSON) => responseJSON.products)
                                                         .reduce((arr1, arr2) => [...arr1, ...arr2]);
}

// Method to get all the epcEvent mapping from the traced response
export function getEpcEventsMapFromTrace(traceResponse, parentAssetMap): {} {
  const epcEventMap = { outputs: {} , inputs: [{}] };
  epcEventMap.outputs = {
    epc_id : traceResponse.epc_id,
    // events: traceResponse.events
    events: traceResponse.events.filter((event) => {
      return (event.asset_id.includes('observation')
              || event.asset_id.includes('aggregation')
              || event.asset_id.includes('commission'));
    })
  };

  const parentEvents = [];
  if (traceResponse.parent_epcs && traceResponse.parent_epcs.length > 0) {
    traceResponse.parent_epcs.forEach(parent => {
      parentEvents.push(...parent.events);
    });
  }

  epcEventMap.inputs.push(...parentEvents.filter((event) => {
    return (event.asset_id.includes('observation')
            || event.asset_id.includes('aggregation')
            || event.asset_id.includes('commission'));
  }));

  epcEventMap.inputs.push(...this.getUpstreamEventsAndEPCs(traceResponse.input_epcs));
  epcEventMap.inputs.push(...this.getDownstreamEventsAndEPCs(traceResponse.output_epcs));

  return epcEventMap;
}

// Recursively loop through the EPC tree to get all events
export function getUpstreamEventsAndEPCs(epcs, parentAssetMap) {

  return (!(epcs && epcs.length > 0)) ? [] : epcs.reduce((allEvents, epc) => { // foreach in the list do the following

    if (epc.input_epcs.length > 0) {
      // if there exist input epcs, traverse further in the tree
      allEvents.push(...this.getUpstreamEventsAndEPCs(epc.input_epcs));
    }

    // NOTE: since we will be processing all intermediate ingredients as well,
    // this will also be run for those cases.
    const parentEvents = [];
    if (epc.parent_epcs && epc.parent_epcs.length > 0) {
      epc.parent_epcs.forEach(parent => {
        parentEvents.push(...parent.events);
      });
    }

    allEvents.push({
      epc_id : epc.epc_id,
      // events: epc.events
      events: [...parentEvents, ...epc.events].filter((event) => {
        return (event.asset_id.includes('observation')
                || event.asset_id.includes('aggregation')
                || event.asset_id.includes('commission'));
      })
    });

    return allEvents;
  }, []);
}

// Recursively loop through the EPC tree to get all events
export function getDownstreamEventsAndEPCs(epcs) {

  return (!(epcs && epcs.length > 0)) ? [] : epcs.reduce((allEvents, epc) => { // foreach in the list do the following

    if (epc.output_epcs.length > 0) {
      // if there exist input epcs, traverse further in the tree
      allEvents.push(...this.getDownstreamEventsAndEPCs(epc.output_epcs));
    }

    // NOTE: since we will be processing all intermediate ingredients as well,
    // this will also be run for those cases.
    const parentEvents = [];
    if (epc.parent_epcs && epc.parent_epcs.length > 0) {
      epc.parent_epcs.forEach(parent => {
        parentEvents.push(...parent.events);
      });
    }

    allEvents.push({
      epc_id : epc.epc_id,
      // events: epc.events
      events: [...parentEvents, ...epc.events].filter((event) => {
        return (event.asset_id.includes('observation')
                || event.asset_id.includes('aggregation')
                || event.asset_id.includes('commission'));
      })
    });

    return allEvents;
  }, []);
}

// Method to call purchase order transactions API to fetch transaction data
export async function getTransactionsData(req, transactionIds, type) {
  if (!transactionIds || !type) {
    return; // return if no type or transaction list is passed.
  }

  const transactions: any[] = [];
  const options = {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: req.headers['authorization'],
    },
    uri: '',
    method: 'GET',
  };

  if (transactionIds && Array.isArray(transactionIds) && transactionIds.length > 0) {
    // loop through the locationIds 30 or PAGE_SIZE at a time
    transactions.push(...await paginate_rp(options, transactionIds, (pagedTransactions) => {
      // form the URL and make the calls
      const transactionsUri = `${config.ift_url}/transactions/${
      type && type === 'PO' ? 'purchase_orders' : type === 'DA' ? 'despatch_advices' : type === 'RA' ? 'receive_advices' : '' }?${
      pagedTransactions && pagedTransactions.length > 0 ? `transaction_id[]=${pagedTransactions.join('&transaction_id[]=')}` : ''}`;
      console.info(`Trace call to get transaction PO data: ${transactionsUri}`);
      return transactionsUri;
    }));
  }

  return (!(transactions && transactions.length > 0)) ? [] : transactions.map((dataObj) => {
    if (type === 'PO') {
      return dataObj.purchase_orders;
    }  if (type === 'DA') {
      return dataObj.despatch_advices;
    } if (type === 'RA') {
      return dataObj.receive_advices;
    }
    return [];
  }).reduce((arr1, arr2) => [...arr1, ...arr2]);
}

// get LGTIN using epcClass
export function getLGTIN(epc: any): { gtin: string, lotOrSerialNo: string, valid: boolean } {
  let epcClass;
  let subProductNo1;
  let subProductNo2;
  let partialGTIN;
  let gtin;
  let lot;

  // handle IFT-issued (non-GS1)
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

/**
 * Returns product info (name, gtin) from epc
 *
 * @param epc EPC string
 */
export function getProductFromEpc(epc: string) {
  let product;
  if (epc && ((epc.indexOf(constants.URN_GS1_SGTIN) >= 0) ||
    (epc.indexOf(constants.URN_IFT_SGTIN) >= 0) ||
    (epc.indexOf(constants.URN_PAT_SGTIN) >= 0))) {
    product = getSGTIN(epc);
  } else if (epc && ((epc.indexOf(constants.URN_GS1_LGTIN) >= 0) ||
    (epc.indexOf(constants.URN_IFT_LGTIN) >= 0))) {
    product = getLGTIN(epc);
  }
  return product;
}
