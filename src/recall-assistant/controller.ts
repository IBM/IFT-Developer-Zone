import * as express from 'express';
import * as _ from 'lodash';

import {
  getEpcs,
  getTransformOutputEpcs,
  getTransactions,
  formatEPCtoCSV,
  formatTransactiontoCSV
} from './ift-service';
import { getSourceEPCData } from './retailer-actions';

import { getIngredientSources } from './ingredient-sources';

// Catch errors that occur in asynchronous code and pass them to Express for processing
export const catchAsync = fn => (...args) => fn(...args).catch(args[2]); // args[2] is next

// Controllers for each endpoint
export const getEpcsHandler: express.RequestHandler = catchAsync(async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  // This will get all EPCs harvested according to the input parameters
  const data = await getEpcs(req);

  // handle different data output types
  const format: string = req.query.output as string;

  if (!format || format.trim().toUpperCase() === 'CSV') {
    const [csv_headers, csv_rows] = await formatEPCtoCSV(req, data);
    res.status(200).header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename="impacted_transactions-${Date.now()}.csv"`);

    writeCSVtoResponse(res, csv_headers, csv_rows);

    res.end();
    return res;
  }
  if (format.trim().toUpperCase() === 'JSON') {
    return res.status(200).json(data);
  }

  return res.status(400).json({
    status: 'bad request, invalid value for "output"; should be either "JSON" or "CSV"'
  });
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

  // handle different data output types
  const format: string = req.query.output as string;

  if (!format || format.trim().toUpperCase() === 'CSV') {
    const [csv_headers, csv_rows] = await formatEPCtoCSV(req, totalEpcs);
    res.status(200).header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename="impacted_transactions-${Date.now()}.csv"`);

    writeCSVtoResponse(res, csv_headers, csv_rows);

    res.end();
    return res;
  }
  if (format.trim().toUpperCase() === 'JSON') {
    return res.status(200).json(totalEpcs);
  }

  return res.status(400).json({
    status: 'bad request, invalid value for "output"; should be either "JSON" or "CSV"'
  });
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
  const data = await getTransactions(req, totalEpcs);

  // handle different data output types
  const format: string = req.query.output as string;

  if (!format || format.trim().toUpperCase() === 'CSV') {
    const [csv_headers, csv_rows] = await formatTransactiontoCSV(data);
    res.status(200).header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename="impacted_transactions-${Date.now()}.csv"`);

    writeCSVtoResponse(res, csv_headers, csv_rows);

    res.end();
    return res;
  }
  if (format.trim().toUpperCase() === 'JSON') {
    return res.status(200).json(data.map(el => el.id));
  }

  return res.status(400).json({
    status: 'bad request, invalid value for "output"; should be either "JSON" or "CSV"'
  });
});

/**
 * Provides location information on the ingredients of each provided
 * product restricted by event time and start dates.
 *
 * Returns either a text/csv or an application/json response.
 */
export const getIngredientSourcesHandler: express.RequestHandler = catchAsync(async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  // This will get all the commissioned input epcs and related data

  // handle different data output types
  const format: string = req.query.output as string;

  if (!format || format.trim().toUpperCase() === 'CSV') {
    const [csv_headers, csv_rows] = await getIngredientSources(req);
    res.status(200).header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename="ingredient_source-${Date.now()}.csv"`);

    writeCSVtoResponse(res, csv_headers, csv_rows);

    res.end();
    return res;
  }
  if (format.trim().toUpperCase() === 'JSON') {
    const data = await getSourceEPCData(req);
    return res.status(200).json(data);
  }

  return res.status(400).json({
    status: 'bad request, invalid value for "output"; should be either "JSON" or "CSV"'
  });
});

/**
 * Writes csv content to an express Response object
 *
 * @param res express response object to write to
 * @param csv_headers headers for the csv response
 * @param csv_rows row of CSV rows containing content
 */
function writeCSVtoResponse(res: express.Response, csv_headers: string[], csv_rows: any[]) {
  const headerString = csv_headers.map((value) => {
    return value ? value.toString().replace(/"/g, '""') : '';
  }).join('","');

  res.write(`"${headerString}"`);
  res.write('\n');

  csv_rows.forEach(d => {
    res.write(d.toString());
    res.write('\n');
  });
}
