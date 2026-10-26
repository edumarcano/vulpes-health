import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
import { parseCsv } from '../../server/services/csv.js';
import type { ImportMapping } from '../../shared/imports.js';
const mapping:ImportMapping={schema_version:1,format:'canonical',timezone:'UTC',profile:null,single_profile:true,review_requested:false,source_label:'Synthetic Scale A'};
const fixture=readFileSync('docs/spec/v0.1.0/fixtures/measurements-synthetic.csv','utf8');
const wide:ImportMapping={schema_version:1,format:'wide',timezone:'UTC',profile:null,single_profile:true,review_requested:false,timestamp_column:'Recorded At',local_date_column:null,external_id_column:null,granularity:'instant',metrics:[{column:'Mass (lb)',metric:'weight',unit:'lb',method:'device_reported'},{column:'Fat (%)',metric:'body_fat_percent',unit:'%',method:'device_estimate'}]};
describe('bounded CSV normalization',()=>{
  it('reports second-60 timestamps as invalid in canonical and mapped input',()=>{
    const canonical='observed_at,metric,value,unit,source,granularity\n2026-09-01T23:59:60Z,weight,70,kg,Synthetic Scale A,instant';
    const mapped='Recorded At,Mass (lb),Fat (%)\n2026-09-01T23:59:60,150,20';
    expect(parseCsv(canonical,mapping)).toMatchObject({observations:[],counts:{invalid:1,new:0}});
    expect(parseCsv(mapped,wide)).toMatchObject({observations:[],counts:{invalid:2,new:0}});
  });
  it('normalizes all 28 canonical and five mapped observations, preserving decimals and provenance',()=>{
    const canonical=parseCsv(fixture,mapping);expect(canonical.observations).toHaveLength(28);expect(canonical.counts.invalid).toBe(0);
    expect(canonical.observations[0]).toMatchObject({canonical_value:'70',original_value:'70.0',external_record_id:'synthetic-01-w',provenance:{row:2,column:'value'}});
    const result=parseCsv(readFileSync('docs/spec/v0.1.0/fixtures/wide-synthetic.csv','utf8'),wide);
    expect(result.observations).toHaveLength(5);expect(result.observations[0]!.canonical_value).toBe('68.0388555');expect(result.counts.blank).toBe(1);expect(result.ignored_columns).toEqual(['Notes']);
  });
  it('handles BOM, quoted comma/newlines, and CRLF without coercing blank cells',()=>{
    const csv='\uFEFFRecorded At,Mass (lb),Fat (%),Notes\r\n2026-09-01T08:00:00Z,150,,"quoted, note\nnext"\r\n';
    expect(parseCsv(csv,wide)).toMatchObject({counts:{blank:1,invalid:0},observations:[{canonical_value:'68.0388555'}]});
  });
  it('separates exact profile and source exclusions from invalid values',()=>{
    const csv='observed_at,metric,value,unit,source,granularity,Profile\n2026-09-01T08:00:00Z,weight,70,kg,Synthetic Scale A,instant,A\n2026-09-01T08:00:00Z,weight,70,kg,Synthetic Scale A,instant,B\n2026-09-01T08:00:00Z,weight,bad,kg,Synthetic Scale A,instant,A\n2026-09-01T08:00:00Z,weight,70,kg,Other,instant,A';
    expect(parseCsv(csv,{...mapping,profile:{column:'Profile',value:'A'},single_profile:false})).toMatchObject({counts:{profileExcluded:1,sourceExcluded:1,invalid:1},observations:[{canonical_value:'70'}]});
    expect(()=>parseCsv(csv,{...mapping,single_profile:false})).toThrow();
  });
  it.each(['NaN','Infinity','-1','0','1e3'])('rejects invalid mass %s',value=>{
    expect(parseCsv(fixture.split(/\r?\n/).slice(0,2).join('\n').replace('70.0',value),mapping).counts.invalid).toBe(1);
  });
  it('rejects malformed, ambiguous, overlarge and excessive input without partial staging',()=>{
    expect(()=>parseCsv('a,a\n1,2',mapping)).toThrow('unique');expect(()=>parseCsv('a,b\n"bad',mapping)).toThrow('malformed');
    expect(()=>parseCsv('x'.repeat(1024*1024+1),mapping)).toThrow('1 MiB');expect(()=>parseCsv('🦊'.repeat(300000),mapping)).toThrow('1 MiB');
    expect(()=>parseCsv(fixture.split(/\r?\n/)[0]+'\n'+(fixture.split(/\r?\n/)[1]+'\n').repeat(5001),mapping)).toThrow('5,000');
    expect(parseCsv('Recorded At,Mass (lb),Fat (%)\n2026-11-01T01:30:00,150,20',{...wide,timezone:'America/New_York'}).counts.invalid).toBe(2);
  });
  it('bounds row errors and does not silently lose their count',()=>{
    const result=parseCsv(fixture.split(/\r?\n/)[0]+'\n'+(fixture.split(/\r?\n/)[1]!.replace('70.0','bad')+'\n').repeat(60),mapping);
    expect(result.errors).toHaveLength(50);expect(result.errors_omitted).toBe(10);expect(result.counts.invalid).toBe(60);
  });
  it('preserves source warnings alongside an explicit review flag without interpreting them',()=>{
    const lines=fixture.trim().split(/\r?\n/);const csv=lines[0]+',quality_flags\n'+lines[1]+',source_warning;device_estimate_uncertain';
    const result=parseCsv(csv,{...mapping,review_requested:true});expect(result.counts.invalid).toBe(0);expect(result.observations[0]!.quality_flags).toEqual(['source_warning','device_estimate_uncertain','review_requested']);
  });
});
