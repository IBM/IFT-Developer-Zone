import { Router } from 'express';
import { getIngredientSourcesHandler,
         getEpcsHandler,
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

    // Return commisisoned EPCs and their related data
    router.get('/ingredient-sources' , getIngredientSourcesHandler);

    return router;
  }
}
