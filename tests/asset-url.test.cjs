const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assetBaseUrl}=require('../.qa/asset-url.js');

test('asset base keeps the GitHub Pages repository subpath',()=>{
 assert.equal(assetBaseUrl('/racewalk-youzhen-lab/','https://alger68.github.io/racewalk-youzhen-lab/'), 'https://alger68.github.io/racewalk-youzhen-lab/');
 assert.equal(new URL('models/model.task',assetBaseUrl('/racewalk-youzhen-lab/','https://alger68.github.io/racewalk-youzhen-lab/')).href,'https://alger68.github.io/racewalk-youzhen-lab/models/model.task');
});
