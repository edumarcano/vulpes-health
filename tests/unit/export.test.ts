import {describe,expect,it} from 'vitest';
import {parse} from 'csv-parse/sync';
import {csvDecimal,csvText} from '../../server/services/export.js';
import {CorrectMeasurementSchema,DeleteMeasurementSchema} from '../../shared/data.js';
const target={measurement_id:'00000000-0000-4000-8000-000000000001',expected_version:1,client_request_id:'00000000-0000-4000-8000-000000000002'};
describe('canonical spreadsheet CSV',()=>{
  it.each(['=1+1','+SUM(A1:A2)','-cmd','@SUM(1)',' \t=1','\r=1','\n@1','\u0001\u200B-1','\uFEFF=1','\tordinary','\nordinary'])('protects untrusted text %j',value=>{
    expect(parse(csvText(value)+'\r\n')[0]).toEqual(["'"+value]);
  });
  it.each(['-1','-0.000000000000000001','+2.50','150.000000000000001'])('preserves exact numeric meaning %s',value=>{
    expect(parse(csvDecimal(value)+'\r\n')[0]).toEqual([value]);
  });
  it('quotes commas, quotes and line breaks without inventing cells',()=>{
    const value='Synthetic, "device"\r\nsecond line';expect(parse(csvText(value)+',"next"\r\n')[0]).toEqual([value,'next']);
    expect(()=>csvDecimal('-cmd')).toThrow();expect(()=>csvDecimal('1e3')).toThrow();
  });
  it('limits corrections to editable fields and requires versions and retry identity',()=>{
    const body={...target,action:'correct_measurement',changes:{value:'150',unit:'lb',observed_at:'2026-09-01T08:00:00Z',timezone:'UTC',local_date:null}};
    expect(CorrectMeasurementSchema.safeParse(body).success).toBe(true);
    for(const extra of [{metric:'weight'},{source_id:target.measurement_id},{method:'unknown'},{quality_flags:[]},{external_record_id:'new'}])expect(CorrectMeasurementSchema.safeParse({...body,changes:{...body.changes,...extra}}).success).toBe(false);
    expect(DeleteMeasurementSchema.safeParse({...target,action:'delete_measurement',expected_version:0}).success).toBe(false);
    expect(DeleteMeasurementSchema.safeParse({action:'delete_measurement',measurement_id:target.measurement_id}).success).toBe(false);
  });
});
