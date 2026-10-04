import type { ExportDatasetName } from '../../domain/export-datasets.js';
import { CATALOG_READERS } from './catalog.readers.js';
import type { DatasetReaders } from './dataset-reader.js';
import { IDENTITY_READERS } from './identity.readers.js';
import { ORGANIZATION_READERS } from './organization.readers.js';
import { TICKETS_READERS } from './tickets.readers.js';
import { TRAIL_READERS } from './trail.readers.js';
import { WORKFLOWS_READERS } from './workflows.readers.js';

/** One reader per dataset: the type fails to compile when a dataset of EXPORT_DATASETS has none. */
export const DATASET_READERS: DatasetReaders<ExportDatasetName> = {
  ...ORGANIZATION_READERS,
  ...IDENTITY_READERS,
  ...CATALOG_READERS,
  ...WORKFLOWS_READERS,
  ...TICKETS_READERS,
  ...TRAIL_READERS,
};

export { type DatasetReader, type KeyValue } from './dataset-reader.js';
