import { getEpcs, getTransformOutputEpcs, getTransactions } from './recall-assistant/ift-service';
import { getSourceEPCData } from './recall-assistant/retailer-actions';

import { getIngredientSources } from './recall-assistant/ingredient-sources';
import { formatEPCtoCSV, formatTransactiontoCSV } from './recall-assistant/format';

import * as _ from 'lodash';
const fs = require('fs');

const helpString = `
==IFT Recall Assistant CLI==
usage: node ${require.main.filename} endpoint [-h] [-b BEARER] [--outputFile PATH] [--** [PARAM]]
usage: npm run cli -- endpoint [-h] [-b BEARER] [--outputFile PATH] [--** [PARAM]]

arguments:
  endpoint              the endpoint to make a call to (e.g. harvested-epcs)

optional arguments:
  -h, --help            show this help message and exit
  -b, --bearer BEARER   the bearer authentication token for IFT
  --outputFile PATH     path to the file you want to save the output to (if
                        not provided, will print to console)
  --** PARAM            any parameters to pass to the endpoint call
                        if multiple values per parameter, provide space
                        separated values
`;

interface CallParameters {
  endpoint: string;
  bearer: string;
  outputFile: string;
  query: {};
}

const harvestedEPCs = async (req) => {
  const harvestedEpcs = await getEpcs(req);

  if ((req.query['output'] || 'CSV').trim().toUpperCase() === 'CSV') {
    return formatEPCtoCSV(req, harvestedEpcs);
  }
  return harvestedEpcs;
};

const impactedEPCs = async (req) => {
  const harvestedEpcs = await getEpcs(req);
  // In addition to the harvested EPCs, find any products that these were transformed into as
  // these are also impacted by any recall
  const totalEpcs = _.union(harvestedEpcs, await getTransformOutputEpcs(req, harvestedEpcs));

  if ((req.query['output'] || 'CSV').trim().toUpperCase() === 'CSV') {
    return formatEPCtoCSV(req, totalEpcs);
  }
  return totalEpcs;
};

const impactedTransactions = async (req) => {
  const harvestedEpcs = await getEpcs(req);
  const totalEpcs = _.union(harvestedEpcs, await getTransformOutputEpcs(req, harvestedEpcs));
  // From the list of bad EPCs (harvested or produced), find aggregations that reference transactions
  // (purchase orders and despatch advice documents)
  const data = await getTransactions(req, totalEpcs);

  if ((req.query['output'] && req.query['output'].trim().toUpperCase()) === 'JSON') {
    return data.map(transaction => transaction.id);
  }
  return formatTransactiontoCSV(data);
};

const availableEndpoints = {
  CSV: {
    'harvested-epcs': harvestedEPCs,
    'impacted-epcs': impactedEPCs,
    'impacted-transactions': impactedTransactions,
    'ingredient-sources': getSourceEPCData,
  },
  JSON: {
    'harvested-epcs': getEpcs,
    'impacted-epcs': impactedEPCs,
    'impacted-transactions': harvestedEPCs,
    'ingredient-sources': getIngredientSources,
  }
};

const arrayParams = [
  'product_id',
  'location_id'
];

const parseArgs = (args: string[]): CallParameters => {
  const params: CallParameters = <CallParameters>{};
  const userArgs = {};

  // print help string and exit
  if (!args || !args.length || args.includes('-h') || args.includes('--help')) {
    console.info(helpString);
    process.exit();
  } else {
    params.endpoint = args[0];
    if (!Object.keys(availableEndpoints.CSV).includes(params.endpoint)) {
      throw new Error(`Invalid Endpoint: ${params.endpoint}`);
    }

    let key = '';
    for (let i = 1; i < args.length; i += 1) {
      if (args[i] === '-b' || args[i] === '--bearer') {
        key = 'bearer';
      } else if (args[i].startsWith('--')) {
        // set the key whenever an argument passed starts with '--'
        key = args[i].slice(2);
      } else {
        // if there is no previous value, set key --> value
        // if there is a previous value, and it is an array, push
        // if there is a previous value, and it is not an array, make it an array then push
        const v = userArgs[key];
        if (!v) {
          userArgs[key] = args[i];
        } else {
          if (Array.isArray(v)) {
            v.push(args[i]);
          } else {
            userArgs[key] = [v, args[i]];
          }
        }
      }
    }

    // Certain params must appear as arrays
    arrayParams.forEach((param) => {
      const arg = userArgs[param];
      if (arg && !Array.isArray(arg)) {
        userArgs[param] = [arg];
      }
    });

    params.bearer = userArgs['bearer'];
    params.outputFile = userArgs['outputFile'];

    if (!params.bearer) {
      throw new Error('Authentication Error: Must provide a bearer token');
    }
    params.query = userArgs;
  }

  return params;
};

const handleHTTPError = (error) => {
  if (error['name'] === 'StatusCodeError') {
    console.error(error['statusCode']);
  }
  console.error(error['error']);
  process.exit();
};

const printCSV = (csvResponse) => {
  const [csv_headers, csv_rows] = csvResponse;

  // print headers
  const headerString = (csv_headers as string[]).map((value) => {
    return value ? value.toString().replace(/"/g, '""') : '';
  });

  // print body
  const bodyString = (csv_rows as any[]).map((row) => {
    return row.toString();
  }).join('\n');

  const resString = `'${headerString}'\n${bodyString}`;
  return resString;
};

const save = (path, content) => {
  fs.writeFile(path, content, (err) => {
    if (err) {
      throw err;
    }
  });
};

if (require.main === module) {
  const args: string[] = process.argv.slice(2);

  const params: CallParameters = parseArgs(args);

  const req = {
    headers: {
      authorization: params.bearer
    },
    query: params.query
  };

  console.log(params.endpoint);

  const format = (req.query['output'] || 'CSV').trim().toUpperCase();
  const endpoint = availableEndpoints[format] && availableEndpoints[format][params.endpoint];

  let resString: string;

  if (endpoint) {
    endpoint(req).catch(handleHTTPError).then((response) => {
      switch (format) {
        case 'JSON':
          resString = JSON.stringify(response, null, 2);
          break;
        case 'CSV':
          resString = printCSV(response);
          break;
        default:
          resString = 'd';
      }
      console.log('test1');
      if (params.outputFile) {
        save(params.outputFile, resString);
      } else {
        console.log('Result:');
        console.log(resString);
      }
    });
  } else {
    throw new Error(`Unsupported endpoint "\\${params.endpoint}" with filetype "${format}"`);
  }
}
