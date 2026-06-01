/**
 * Utility module to extract accessibility-relevant properties from document nodes
 * and determine their PDF structure type.
 */

/**
 * Returns the PDF structure tag for a node based on its properties.
 *
 * @param {object} node - A pdfmake document node
 * @returns {string} The PDF structure type (e.g. 'P', 'H1', 'Figure', 'Artifact')
 */
export function getAccessibilityRole(node) {
	if (!node) {
		return 'Artifact';
	}

	// Explicit accessibilityTag takes precedence, except for grouping tags (BlockQuote)
	// which are handled as containers — individual lines inside still get their own roles.
	if (node.accessibilityTag && node.accessibilityTag !== 'BlockQuote') {
		return node.accessibilityTag;
	}

	// Headings via headlineLevel
	if (node.headlineLevel && node.headlineLevel >= 1 && node.headlineLevel <= 6) {
		return 'H' + node.headlineLevel;
	}

	// Images and SVGs - Figure if alt/actualText present, otherwise Artifact
	if (node.image || node.svg) {
		if (node.alt || node.actualText) {
			return 'Figure';
		}
		return 'Artifact';
	}

	// Canvas / vectors are always artifacts
	if (node.canvas) {
		return 'Artifact';
	}

	// Tables - only tagged if explicitly marked
	if (node.table) {
		if (node.accessibilityTag === 'Table' || node.accessibilityTag === 'TOC') {
			return node.accessibilityTag;
		}
		return null; // no structural tagging for unmarked tables
	}

	// Text nodes default to P (paragraph)
	if (node.text !== undefined) {
		return 'P';
	}

	return null;
}

/**
 * Returns options for pdfKitDoc.struct() based on node properties.
 *
 * @param {object} node
 * @returns {object}
 */
export function getStructureOptions(node) {
	let options = {};

	if (node.alt) {
		options.alt = node.alt;
	}
	if (node.actualText) {
		options.actual = node.actualText;
	}

	return options;
}

/**
 * Checks if a table node should be structurally tagged.
 *
 * @param {object} node
 * @returns {boolean}
 */
export function shouldTagTable(node) {
	return node && (node.accessibilityTag === 'Table' || node.accessibilityTag === 'TOC');
}

/**
 * Checks if a table node is a Table of Contents.
 *
 * @param {object} node
 * @returns {boolean}
 */
export function isTOC(node) {
	return node && node.accessibilityTag === 'TOC';
}
