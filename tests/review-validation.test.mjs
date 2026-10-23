import test from 'node:test';
import assert from 'node:assert/strict';
import { isEditor, validateReview, validDate } from '../lib/review-validation.ts';
const record = {title:'Policy change',summary:'Evidence-based summary',event_type:'consultation',policy_status:'proposal',policy_area:'Energy',jurisdiction:'UK',event_date:'2026-10-23',deadline:'',sectors:[],watchpoints:[],facts:[{id:'F1',statement:'Claim',evidence_url:'https://www.gov.uk/example',page:null,location:'Summary'}]};
test('only the confirmed designated editor is authorized', () => {
 assert.equal(isEditor(null),false);
 assert.equal(isEditor({email:'signalaiproject1@gmail.com'}),false);
 assert.equal(isEditor({email:'other@example.com',email_confirmed_at:'now'}),false);
 assert.equal(isEditor({email:'signalaiproject1@gmail.com',email_confirmed_at:'now'}),true);
});
test('incomplete drafts can be saved, but publication requires checked fields and citations', () => {
 assert.equal(validateReview(record,true),null);
 assert.equal(validateReview({...record,summary:'',facts:[]}),null);
 assert.ok(validateReview({...record,summary:''},true));
 assert.ok(validateReview({...record,policy_status:'definitely happening'},true));
 assert.ok(validateReview({...record,facts:[{...record.facts[0],location:''}]},true));
 assert.ok(validateReview({...record,facts:[{...record.facts[0],page:0}]},true));
 assert.ok(validateReview({...record,facts:[record.facts[0],record.facts[0]]},true));
 assert.equal(validDate('2026-02-30'),false);
 assert.equal(validDate('2026-10-23'),true);
});
