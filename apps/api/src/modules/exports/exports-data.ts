import { ExportCatalogsRepository } from './data/export-catalogs.repository.js';
import { ExportCutoffsRepository } from './data/export-cutoffs.repository.js';
import { ExportDefinitionsRepository } from './data/export-definitions.repository.js';
import { ExportLinesRepository } from './data/export-lines.repository.js';
import { ExportSourcesRepository } from './data/export-sources.repository.js';

/** The repositories both sides of exports use (the API and the worker each provide their own instances). */
export const EXPORT_REPOSITORIES = [ExportDefinitionsRepository, ExportLinesRepository, ExportCutoffsRepository, ExportCatalogsRepository, ExportSourcesRepository];
