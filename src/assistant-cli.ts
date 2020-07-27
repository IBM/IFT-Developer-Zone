import { getEpcs, getTransformOutputEpcs, getTransactions } from './recall-assistant/ift-service';
import { getSourceEPCData } from './recall-assistant/retailer-actions';

import { getIngredientSources } from "./recall-assistant/ingredient-sources";

const fs = require("fs");

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
  endpoint: string,
  bearer: string,
  outputFile: string,
  query: {}
}

const availableEndpoints = {
  "harvested-epcs": getEpcs,
  "impacted-epcs": getTransformOutputEpcs,
  "impacted-transactions": getTransactions,
  "ingredient-sources": null,
};

const arrayParams = [
  "product_id",
  "location_id"
];



const parseArgs = (args: string[]):CallParameters => {
  const params: CallParameters = <CallParameters>{};
  const userArgs = {};

  // print help string and exit
  if (!args || !args.length || args.includes("-h") || args.includes("--help")) {
    console.info(helpString);
    process.exit();
  } else {
    params.endpoint = args[0];
    if (!Object.keys(availableEndpoints).includes(params.endpoint)) {
      throw new Error(`Invalid Endpoint: ${params.endpoint}`);
    }

    let key = "";
    for(let i = 1; i < args.length; i++) {
      if (args[i] == "-b" || args[i] == "--bearer") {
        key = "bearer";
      } else if (args[i].startsWith("--")) {
        // set the key whenever an argument passed starts with '--'
        key = args[i].slice(2);
      } else {
        // if there is no previous value, set key --> value
        // if there is a previous value, and it is an array, push
        // if there is a previous value, and it is not an array, make it an array then push
        let v = userArgs[key];
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
      let arg = userArgs[param];
      if (arg && !Array.isArray(arg)) {
        userArgs[param] = [arg];
      }
    });

    params.bearer = userArgs["bearer"];
    params.outputFile = userArgs["outputFile"];

    if (!params.bearer) {
      throw new Error("Authentication Error: Must provide a bearer token");
    }

    params.query = userArgs;
    
  }

  return params;
}

const handleHTTPError = (error) => {
  if (error['name'] === "StatusCodeError") {
    // actually already handled in the stack
    console.error(error['statusCode']);
    console.error(error["error"]);
    process.exit();
  }
}

const printCSV = (csvResponse) => {
  const [csv_headers, csv_rows] = csvResponse;

  // print headers
  let headerString = (csv_headers as string[]).map((value) => {
    return value ? value.toString().replace(/"/g, "\"\""): ""
  });

  // print body
  let bodyString = (csv_rows as any[]).map((row) => {
    return row.toString();
  }).join("\n");

  const resString = `"${headerString}"\n${bodyString}`;
  return resString;
}

const save = (path, content) => {
  fs.writeFile(path, content, (err) => {
    if (err) throw err;
  });
}


if (require.main === module) {
  const args: string[] = process.argv.slice(2);

  const params: CallParameters = parseArgs(args);

  const req = {
    headers: {
      authorization: params.bearer
    },
    query: params.query
  };

  let endpoint = availableEndpoints[params.endpoint];
  console.log(params.endpoint);
  let resString = "";
  if (endpoint) {
    endpoint(req).then((response) => {
      if (!req.query["output"] || req.query["output"].toUpperCase() === "JSON") {
        resString = JSON.stringify(response, null, 2);
      } else if (req.query["output"].toUpperCase() === "CSV") {
        resString = printCSV(response);
      }
      if (params.outputFile) {
        save(params.outputFile, resString);
      } else {
        console.log("Result:");
        console.log(resString);
      }
    }).catch(handleHTTPError);
  } else {
    // we need to treat ingredient-sources differently since
    // it has two different methods handling it
    if (!req.query["output"] || req.query["output"].toUpperCase() === "JSON") {
      getSourceEPCData(req).then((jsonResponse) => {
        resString = JSON.stringify(jsonResponse, null, 2);
        if (params.outputFile) {
          save(params.outputFile, resString);
        } else {
          console.log("Result:");
          console.log(resString);
        }
      }).catch(handleHTTPError);
    } else if (req.query["output"].toUpperCase() === "CSV") {
      getIngredientSources(req).then((csvResponse) => {
        resString = printCSV(csvResponse);
        if (params.outputFile) {
          save(params.outputFile, resString);
        } else {
          console.log("Result:");
          console.log(resString);
        }
      }).catch(handleHTTPError);
    }
  }
}
