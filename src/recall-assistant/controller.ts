/*
 * IBM Confidential
 * OCO Source Materials
 * 5900-A1Y
 *
 * © Copyright IBM Corp. 2019
 *
 * The source code for this program is not published or
 * otherwise divested of its trade secrets, irrespective of
 * what has been deposited with the U.S. Copyright Office.
 */

import * as express from 'express';
import * as _ from 'lodash';

import { getEpcs, getTransformOutputEpcs, getTransactions } from './ift-service';

// Catch errors that occur in asynchronous code and pass them to Express for processing
export const catchAsync = fn => (...args) => fn(...args).catch(args[2]); // args[2] is next

// Controllers for each endpoint
export const getEpcsHandler: express.RequestHandler = catchAsync(async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  // This will get all EPCs harvested according to the input parameters
  return res.status(200).json(await getEpcs(req));
});

export const getEpcsWithTransformsHandler: express.RequestHandler = catchAsync(async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const harvestedEpcs = await getEpcs(req);
  // In addition to the harvested EPCs, find any products that these were transformed into as
  // these are also impacted by any recall
  const totalEpcs = _.union(harvestedEpcs, await getTransformOutputEpcs(req, harvestedEpcs));
  return res.status(200).json(totalEpcs);
});

export const getTransactionsHandler: express.RequestHandler = catchAsync(async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const harvestedEpcs = await getEpcs(req);
  const totalEpcs = _.union(harvestedEpcs, await getTransformOutputEpcs(req, harvestedEpcs));
  // From the list of bad EPCs (harvested or produced), find aggregations that reference transactions
  // (purchase orders and despatch advice documents)
  return res.status(200).json(await getTransactions(req, totalEpcs));
});
