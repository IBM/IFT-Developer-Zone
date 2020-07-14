// Test Libraries
import { expect } from 'chai';
import { getTraceConstraintParameters } from '../../../recall-assistant/ift-service';

describe('Testing getTraceConstraintParameters', function () {
  describe('ensure correct url creation', function () {
    it('should show correct URL for commission case', async function () {
      const urlRestraintParameters = getTraceConstraintParameters('urn:ibm:ift:location:loc:prefix.identifier',
        ['gtin1', 'gtin2'],
        '2019-11-01',
        '2019-11-15');
      const traceCallUri = 'https://food.ibm.com/ift/api/outbound/v2/events?event_type[]=commission' +
        urlRestraintParameters;
      return expect(traceCallUri).to.equal('https://food.ibm.com/ift/api/outbound/v2/events?event_type[]='
        + 'commission&location_id[]=urn%3Aibm%3Aift%3Alocation%3Aloc%3Aprefix.identifier&product_id[]=gtin1'
        + '&product_id[]=gtin2&event_start_timestamp=2019-11-01&event_end_timestamp=2019-11-15');
    });
  });
});
