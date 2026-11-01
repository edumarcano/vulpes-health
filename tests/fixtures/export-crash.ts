import {exportMeasurements} from '../../server/services/export.js';
import type {AuthContext} from '../../server/auth/session.js';

// Disposable child process: exercises production export staging without a database.
const context={userId:'00000000-0000-4000-8000-000000000001',db:{
 from(){return {select(){return this;},eq(){return this;},abortSignal(){return this;},async maybeSingle(){return {data:{id:'synthetic'},error:null};}};},
 rpc(name:string){return {async abortSignal(){return {data:name==='read_export_v1'?{revision:0,rows:[]}:{revision:0},error:null};}};},
}} as unknown as AuthContext;
await exportMeasurements(context,{view:'export',metric:'weight',method:'device_reported',granularity:'instant',source_id:'00000000-0000-4000-8000-000000000002',from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z',timezone:'UTC'});
// Deliberately bypasses export cleanup, as a process crash would.
process.exit(17);
