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

import { Router } from 'express';
import { getEpcsHandler,
         getEpcsWithTransformsHandler,
         getTransactionsHandler
       } from './controller';

export class TraceAssistantRouter {
  static getRouter(): Router {
    const router = Router();

    // Return EPCs that we harvested with the matching criteria
    router.get('/harvested-epcs' , getEpcsHandler);

    // Return EPCs that contain any of the the matching data as ingredients
    router.get('/impacted-epcs' , getEpcsWithTransformsHandler);

    // Return Transactions that contain impacted EPCs
    router.get('/impacted-transactions' , getTransactionsHandler);

    return router;
  }
}
