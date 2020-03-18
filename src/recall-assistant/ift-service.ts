import { config } from '../app';
import * as rp from 'request-promise-native';
import * as _ from 'lodash';

const EVENT_PAGE_SIZE = 30;

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
      pagedEPC = epcIds.splice(0, EVENT_PAGE_SIZE);

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

  return Promise.all(eventsPromiseList).then((eventResponse: any) => {
    // Get a list of all EPCs listed as outputs on these tranformations
    let epcs: string[] = [];
    eventResponse.forEach((response) => {
      const eventsObj = JSON.parse(response);
      eventsObj.events.forEach((event) => {
        event.output_quantities.forEach((output) => {
          epcs = _.union(epcs, [output.epc_id]);
        });
      });
    });
    return epcs;
  }).catch((err) => {
    console.error(`Error getting EPCs from relevant events: ${err}`);
    throw err;
  });
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
      pagedEPC = epcIds.splice(0, EVENT_PAGE_SIZE);

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

  return Promise.all(eventsPromiseList).then((eventResponse: any) => {
    let transactionIds: string[] = [];
    eventResponse.forEach((response) => {
      const eventsObj = JSON.parse(response);
      eventsObj.events.forEach((event) => {
        // Loop through transactions on each event to get ids
        event.transaction_ids.forEach((transaction) => {
          transactionIds = _.union(transactionIds, [transaction.id]);
        });
      });
    });
    return transactionIds;
  }).catch((err) => {
    console.error(`Error getting EPCs from relevant events: ${err}`);
    throw err;
  });
}
