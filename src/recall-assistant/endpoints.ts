
import { getEpcs, getTransformOutputEpcs, getTransactions } from './ift-service';
import { getSourceEPCData } from './retailer-actions';
import { getIngredientSources } from './ingredient-sources';

import { formatEPCtoCSV, formatTransactiontoCSV } from './format';

import * as _ from 'lodash';

export const harvestedEPCs = async (req) => {
  const harvestedEpcs = await getEpcs(req);

  if ((req.query['output'] || 'CSV').trim().toUpperCase() === 'CSV') {
    return formatEPCtoCSV(req, harvestedEpcs);
  }
  return harvestedEpcs;
};

export const impactedEPCs = async (req) => {
  const harvestedEpcs = await getEpcs(req);
  // In addition to the harvested EPCs, find any products that these were transformed into as
  // these are also impacted by any recall
  const totalEpcs = _.union(harvestedEpcs, await getTransformOutputEpcs(req, harvestedEpcs));

  if ((req.query['output'] || 'CSV').trim().toUpperCase() === 'CSV') {
    return formatEPCtoCSV(req, totalEpcs);
  }
  return totalEpcs;
};

export const impactedTransactions = async (req) => {
  const harvestedEpcs = await getEpcs(req);
  const totalEpcs = _.union(harvestedEpcs, await getTransformOutputEpcs(req, harvestedEpcs));
  // From the list of bad EPCs (harvested or produced), find aggregations that reference transactions
  // (purchase orders and despatch advice documents)
  const data = await getTransactions(req, totalEpcs);

  if ((req.query['output'] || 'CSV').trim().toUpperCase() === 'CSV') {
    return formatTransactiontoCSV(data, req);
  }
  return data;
};

export const ingredientSources = async (req) => {
  if ((req.query['output'] || 'CSV').trim().toUpperCase() === 'CSV') {
    return getIngredientSources(req);
  }
  return getSourceEPCData(req);
};

export const productDestinations = async (req) => {
  if ((req.query['output'] || 'CSV').trim().toUpperCase() === 'CSV') {
    return getIngredientSources(req, { upstream: false, downstream: true });
  }
  return getSourceEPCData(req, { upstream: false, downstream: true });
};
