import * as _ from 'lodash';
import {
  getProductFromEpc,
  getProductsData
} from './ift-service';

/**
 * CSVRow object to standardize order of output as well as easily
 *
 */
export class CSVRow extends Map<string, string | Date> {
  headers: string[];
  constructor(headers) {
    super();
    this.headers = headers;
    headers.forEach((col) => this.set(col, null));
    return this;
  }

  /**
   * shallow copy
   */
  copy() {
    const copy = new CSVRow(this.headers);
    for (const [key, value] of this) {
      copy.set(key, value);
    }
    return copy;
  }

  /**
   * produces a valid row as csv string
   *
   * @returns: row as csv string
   */
  toString(): string {
    const values = this.headers.map((col) => {
      const value = this.get(col);
      return value ? value.toString().replace(/"/g, '""') : '';
    });
    return `"${values.join('\",\"')}"`;
  }
}

// All available columns/headers for the csv output
export const ALL_HEADERS = {
  productEPC: 'Product (EPC)',
  productName: 'Product Name',
  productGTIN: 'Product GTIN',
  finishedProductEPC: 'Finished Product (EPC)',
  finishedProductName: 'Finished Product Name',
  finishedProductGTIN: 'Finished Product GTIN',
  finalLocationID: 'Final Location (GLN)',
  finalLocationName: 'Final Location Name',
  finalLocationType: 'Final Location Type',
  arrivalDate: 'Arrival Date',
  ingredientEPC: 'Ingredient (EPC)',
  ingredientName: 'Ingredient Name',
  ingredientGTIN: 'Ingredient GTIN',
  sourceLocationID: 'Source Location (GLN)',
  sourceLocationName: 'Source Location Name',
  sourceLocationType: 'Source Location Type',
  creationDate: 'Creation Date',
  transactionID: 'Transaction ID',
  transactionType: 'Transaction Type',
  eventTime: 'Event Time'
};

export const PRODUCT_CSV_HEADERS = [
  ALL_HEADERS.productEPC,
  ALL_HEADERS.productName,
  ALL_HEADERS.productGTIN,
];

export const TRANSACTION_CSV_HEADERS = [
  ALL_HEADERS.transactionID,
  ALL_HEADERS.transactionType,
  ALL_HEADERS.productEPC,
  ALL_HEADERS.productName,
  ALL_HEADERS.productGTIN,
  ALL_HEADERS.eventTime
];

/**
 * Reducing the values in here reduces output viewed in csv output
 */
export const INGREDIENT_CSV_HEADERS = [
  ALL_HEADERS.finishedProductEPC,
  ALL_HEADERS.finishedProductName,
  ALL_HEADERS.finishedProductGTIN,
  ALL_HEADERS.finalLocationID,
  ALL_HEADERS.finalLocationName,
  ALL_HEADERS.finalLocationType,
  ALL_HEADERS.arrivalDate,
  ALL_HEADERS.ingredientEPC,
  ALL_HEADERS.ingredientName,
  ALL_HEADERS.ingredientGTIN,
  ALL_HEADERS.sourceLocationID,
  ALL_HEADERS.sourceLocationName,
  ALL_HEADERS.sourceLocationType,
  ALL_HEADERS.creationDate,
];

/**
 * Returns strings in CSV format
 *
 * @param EPCs array of EPCs
 */
export async function formatEPCtoCSV(req, EPCs: string[]): Promise<[string[], CSVRow[]]> {
  const rows: CSVRow[] = [];

  const product_info = [];
  if (!!EPCs) {
    EPCs.forEach(EPC => {
      const productFromEPC = getProductFromEpc(EPC);
      if (productFromEPC) {
        product_info.push({
          epc: EPC,
          product: productFromEPC
        });
      }
    });
  }

  const all_products = await getProductsData(req, _.uniq(product_info.map(p => p.product.gtin)));

  product_info.forEach(({ epc, product }) => {
    const row = new CSVRow(PRODUCT_CSV_HEADERS);
    row.set(ALL_HEADERS.productEPC, epc);

    const products = all_products.filter((p) => {
      return p.id === product.gtin;
    });

    if (!!products) {
      products.forEach(p => {
        const pRow = row.copy();
        pRow.set(ALL_HEADERS.productName, (p && p.description) || '');
        pRow.set(ALL_HEADERS.productGTIN, (p && p.id) || '');

        rows.push(pRow);
      });
    } else {
      rows.push(row);
    }
  });

  return [PRODUCT_CSV_HEADERS, rows];
}

/**
 * Format transactions into CSV format
 *
 * @param transactions transactions to format into csv
 */
export async function formatTransactiontoCSV(transactions, req): Promise<[string[], CSVRow[]]> {
  const rows: CSVRow[] = [];
  const tRows: CSVRow[] = [];

  const product_info = [];

  if (!!transactions) {
    transactions.forEach(transaction => {
      const row = new CSVRow(TRANSACTION_CSV_HEADERS);

      row.set(ALL_HEADERS.transactionID, transaction.id);
      if (transaction.type.includes(':po') || transaction.type.includes(':prodorder')) {
        row.set(ALL_HEADERS.transactionType, 'PO');
      } else if (transaction.type.includes(':desadv')) {
        row.set(ALL_HEADERS.transactionType, 'DA');
      } else if (transaction.type.includes(':recadv')) {
        row.set(ALL_HEADERS.transactionType, 'RA');
      }

      row.set(ALL_HEADERS.eventTime, transaction.event_time);

      if (transaction.epc_ids && transaction.epc_ids.length > 0) {
        for (const epc_id of transaction.epc_ids) {
          const product_row = row.copy();

          product_row.set(ALL_HEADERS.productEPC, epc_id);

          product_info.push({
            epc: epc_id,
            product: getProductFromEpc(epc_id)
          });
          rows.push(product_row);
        }
      } else {
        rows.push(row);
      }
    });

    const all_products = await getProductsData(req,
      _.uniq(product_info.filter(p => !!p.product).map(p => p.product.gtin)));

    const productsDict = {};
    product_info.forEach((product) => {
      productsDict[product.epc] = (product.product && product.product.gtin) || undefined;
    });

    for (const row of rows) {
      const product = productsDict[row.get(ALL_HEADERS.productEPC) as string];

      if (product) {
        const products = all_products.filter((p) => {
          return p.id === product;
        });

        if (products.length > 0) {
          products.forEach(p => {
            const tRow = row.copy();

            tRow.set(ALL_HEADERS.productName, (p && p.description) || '');
            tRow.set(ALL_HEADERS.productGTIN, (p && p.id) || '');

            tRows.push(tRow);
          });
        } else {
          tRows.push(row);
        }
      } else {
        tRows.push(row);
      }
    }

  }

  return [TRANSACTION_CSV_HEADERS, _.uniq(tRows)];
}
