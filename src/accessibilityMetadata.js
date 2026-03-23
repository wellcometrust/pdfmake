'use strict';

/**
 * Utility module to extract accessibility-relevant properties from document nodes
 * and determine their PDF structure type.
 */

/**
 * Returns the PDF structure tag for a node based on its properties.
 *
 * @param {Object} node - A pdfmake document node
 * @param {Object} [context] - Optional context about the node's position in the document tree
 * @param {boolean} [context.inList] - Whether the node is inside a list
 * @param {boolean} [context.inTable] - Whether the node is inside a table
 * @returns {string} The PDF structure type (e.g. 'P', 'H1', 'Figure', 'Artifact')
 */
function getAccessibilityRole(node, context) {
	if (!node) {
		return 'Artifact';
	}

	// Explicit accessibilityTag takes precedence
	if (node.accessibilityTag) {
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
 */
function getStructureOptions(node) {
	var options = {};

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
 */
function shouldTagTable(node) {
	return node && (node.accessibilityTag === 'Table' || node.accessibilityTag === 'TOC');
}

/**
 * Checks if a table node is a Table of Contents.
 */
function isTOC(node) {
	return node && node.accessibilityTag === 'TOC';
}

module.exports = {
	getAccessibilityRole: getAccessibilityRole,
	getStructureOptions: getStructureOptions,
	shouldTagTable: shouldTagTable,
	isTOC: isTOC
};
