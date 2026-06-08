import { CATALOG_DATA, sourceForIdx } from './src/variation-catalog-data';
for (const doc of CATALOG_DATA) {
  if (doc.source !== sourceForIdx(doc.idx)) {
    console.log("Source mismatch on", doc.name, doc.idx, "expected", sourceForIdx(doc.idx), "but got", doc.source);
  }
  if (doc.params !== undefined && doc.params.length === 0) {
    console.log("Empty params on", doc.name);
  }
}
