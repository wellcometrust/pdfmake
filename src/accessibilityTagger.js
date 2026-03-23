'use strict';

/**
 * AccessibilityTagger - manages the PDF structure tree for tagged/accessible PDFs.
 *
 * Uses PDFKit's struct(), markStructureContent(), endMarkedContent(), and addStructure()
 * APIs to build a logical structure tree conforming to PDF/UA conventions.
 *
 * Structure hierarchy:
 *   Document
 *     └─ Sect (one per page)
 *         ├─ H1..H6 (headings)
 *         ├─ P (paragraphs)
 *         ├─ L (lists)
 *         │   └─ LI
 *         │       ├─ Lbl (marker - optional)
 *         │       └─ LBody
 *         │           ├─ P / H1..H6
 *         │           └─ L (nested lists)
 *         ├─ Table / TOC
 *         │   ├─ THead
 *         │   │   └─ TR > TH
 *         │   └─ TBody
 *         │       └─ TR > TD
 *         ├─ Figure (images/SVGs with alt text)
 *         ├─ Link
 *         └─ Artifact (decorative content)
 */

function AccessibilityTagger(pdfKitDoc) {
	this.doc = pdfKitDoc;

	// Root document structure element
	this.documentElement = null;

	// Current page section
	this.currentSect = null;

	// Text structure tracking
	this.currentTextElement = null; // Current P or H element
	this.currentTextRole = null;    // 'P', 'H1', etc.

	// List tracking - stack for nesting
	this.listStack = [];        // Stack of { listElement, currentItem, currentLBody }
	this.currentList = null;
	this.currentListItem = null;
	this.currentLBody = null;

	// Table tracking
	this.currentTable = null;
	this.currentTHead = null;
	this.currentTBody = null;
	this.currentRow = null;
	this.currentCell = null;
	this.tableIsTOC = false;

	// Link tracking
	this.currentLink = null;

	// Track what's currently open for page break handling
	this.openStructures = [];

	// Artifact nesting
	this._artifactDepth = 0;
}

/**
 * Initialise the root Document element and add to the structure tree.
 */
AccessibilityTagger.prototype.initDocument = function () {
	this.documentElement = this.doc.struct('Document');
	this.doc.addStructure(this.documentElement);
};

/**
 * Finalise the document structure - close all remaining open elements.
 */
AccessibilityTagger.prototype.finalise = function () {
	this._closeAllOpenStructures();
	if (this.currentSect) {
		this.currentSect.end();
		this.currentSect = null;
	}
	if (this.documentElement) {
		this.documentElement.end();
	}
};

// ============================================================================
// Page (Sect) management
// ============================================================================

AccessibilityTagger.prototype.beginPage = function () {
	// Close anything left open from previous page
	this._closeTextElement();
	// Don't close list/table elements here - they may span pages
	// Instead, we handle this via the page break mechanism

	if (!this.currentSect) {
		this.currentSect = this.doc.struct('Sect');
		this.documentElement.add(this.currentSect);
	}
};

AccessibilityTagger.prototype.endPage = function () {
	// End current text element if open
	this._closeTextElement();
};

AccessibilityTagger.prototype.beginNewSection = function () {
	this._closeAllOpenStructures();

	if (this.currentSect) {
		this.currentSect.end();
	}
	this.currentSect = this.doc.struct('Sect');
	this.documentElement.add(this.currentSect);
};

// ============================================================================
// Text elements (P, H1-H6)
// ============================================================================

AccessibilityTagger.prototype.beginTextElement = function (role) {
	if (!role || role === 'Artifact') {
		return;
	}

	// If we already have a text element of the same role open, keep it
	if (this.currentTextElement && this.currentTextRole === role) {
		return;
	}

	// Close any existing text element since the role changed
	this._closeTextElement();

	var parent = this._getCurrentParent();
	if (!parent) {
		return;
	}

	this.currentTextRole = role;
	this.currentTextElement = this.doc.struct(role);
	parent.add(this.currentTextElement);
};

AccessibilityTagger.prototype.endTextElement = function () {
	this._closeTextElement();
};

AccessibilityTagger.prototype._closeTextElement = function () {
	if (this.currentLink) {
		this.currentLink.end();
		this.currentLink = null;
	}
	if (this.currentTextElement) {
		this.currentTextElement.end();
		this.currentTextElement = null;
		this.currentTextRole = null;
	}
};

// ============================================================================
// Mark content for the currently open structure element
// ============================================================================

/**
 * Mark content within the currently active structure element.
 * Returns a function that, when called after content rendering, ends the marked content.
 *
 * @param {string} [tag] - Optional override tag for markStructureContent
 * @returns {Function|null} A cleanup function to call after rendering, or null if no tagging
 */
AccessibilityTagger.prototype.markContent = function (tag) {
	if (this._artifactDepth > 0) {
		return null;
	}

	var activeElement = this.currentLink || this.currentTextElement;
	if (!activeElement) {
		return null;
	}

	var contentTag = tag || this.currentTextRole || 'Span';
	var content = this.doc.markStructureContent(contentTag);
	activeElement.add(content);

	return function () {
		this.doc.endMarkedContent();
	}.bind(this);
};

// ============================================================================
// List structures
// ============================================================================

AccessibilityTagger.prototype.beginList = function () {
	// Close any open text element first
	this._closeTextElement();

	// Push current list context for nesting
	if (this.currentList) {
		this.listStack.push({
			listElement: this.currentList,
			currentItem: this.currentListItem,
			currentLBody: this.currentLBody
		});
	}

	var parent = this._getCurrentParent();
	this.currentList = this.doc.struct('L');
	if (parent) {
		parent.add(this.currentList);
	}
	this.currentListItem = null;
	this.currentLBody = null;
};

AccessibilityTagger.prototype.beginListItem = function () {
	this._closeTextElement();

	if (this.currentLBody) {
		this.currentLBody.end();
		this.currentLBody = null;
	}
	if (this.currentListItem) {
		this.currentListItem.end();
	}

	this.currentListItem = this.doc.struct('LI');
	if (this.currentList) {
		this.currentList.add(this.currentListItem);
	}

	this.currentLBody = this.doc.struct('LBody');
	this.currentListItem.add(this.currentLBody);
};

AccessibilityTagger.prototype.endListItem = function () {
	this._closeTextElement();

	if (this.currentLBody) {
		this.currentLBody.end();
		this.currentLBody = null;
	}
	if (this.currentListItem) {
		this.currentListItem.end();
		this.currentListItem = null;
	}
};

AccessibilityTagger.prototype.endList = function () {
	this._closeTextElement();
	this.endListItem();

	if (this.currentList) {
		this.currentList.end();
	}

	// Pop parent list context
	if (this.listStack.length > 0) {
		var parentCtx = this.listStack.pop();
		this.currentList = parentCtx.listElement;
		this.currentListItem = parentCtx.currentItem;
		this.currentLBody = parentCtx.currentLBody;
	} else {
		this.currentList = null;
		this.currentListItem = null;
		this.currentLBody = null;
	}
};

// ============================================================================
// Table structures
// ============================================================================

AccessibilityTagger.prototype.beginTable = function (isTOC) {
	this._closeTextElement();
	this.tableIsTOC = isTOC;

	var parent = this._getCurrentParent();
	var tableType = isTOC ? 'TOC' : 'Table';
	this.currentTable = this.doc.struct(tableType);
	if (parent) {
		parent.add(this.currentTable);
	}
};

AccessibilityTagger.prototype.beginTableHeader = function () {
	if (!this.currentTable) { return; }
	this.currentTHead = this.doc.struct('THead');
	this.currentTable.add(this.currentTHead);
};

AccessibilityTagger.prototype.endTableHeader = function () {
	if (this.currentTHead) {
		this.currentTHead.end();
		this.currentTHead = null;
	}
};

AccessibilityTagger.prototype.beginTableBody = function () {
	if (!this.currentTable) { return; }
	this.currentTBody = this.doc.struct('TBody');
	this.currentTable.add(this.currentTBody);
};

AccessibilityTagger.prototype.endTableBody = function () {
	if (this.currentTBody) {
		this.currentTBody.end();
		this.currentTBody = null;
	}
};

AccessibilityTagger.prototype.beginRow = function () {
	if (!this.currentTable) { return; }
	var rowType = this.tableIsTOC ? 'TOCI' : 'TR';
	this.currentRow = this.doc.struct(rowType);
	var parent = this.currentTHead || this.currentTBody || this.currentTable;
	parent.add(this.currentRow);
};

AccessibilityTagger.prototype.endRow = function () {
	this._closeTextElement();
	if (this.currentCell) {
		this.currentCell.end();
		this.currentCell = null;
	}
	if (this.currentRow) {
		this.currentRow.end();
		this.currentRow = null;
	}
};

AccessibilityTagger.prototype.beginCell = function (isHeader) {
	if (!this.currentRow) { return; }

	this._closeTextElement();

	if (this.currentCell) {
		this.currentCell.end();
	}

	var cellType = isHeader ? 'TH' : 'TD';
	this.currentCell = this.doc.struct(cellType);
	this.currentRow.add(this.currentCell);
};

AccessibilityTagger.prototype.endCell = function () {
	this._closeTextElement();
	if (this.currentCell) {
		this.currentCell.end();
		this.currentCell = null;
	}
};

AccessibilityTagger.prototype.endTable = function () {
	this._closeTextElement();
	this.endRow();
	this.endTableHeader();
	this.endTableBody();
	if (this.currentTable) {
		this.currentTable.end();
		this.currentTable = null;
	}
	this.tableIsTOC = false;
};

// ============================================================================
// Figure (images / SVGs with alt text)
// ============================================================================

AccessibilityTagger.prototype.beginFigure = function (options) {
	var parent = this._getCurrentParent();
	if (!parent) { return; }

	var structOpts = {};
	if (options && options.alt) {
		structOpts.alt = options.alt;
	}
	if (options && options.actualText) {
		structOpts.actual = options.actualText;
	}

	this._currentFigure = this.doc.struct('Figure', structOpts);
	parent.add(this._currentFigure);

	var content = this.doc.markStructureContent('Figure');
	this._currentFigure.add(content);
};

AccessibilityTagger.prototype.endFigure = function () {
	this.doc.endMarkedContent();
	if (this._currentFigure) {
		this._currentFigure.end();
		this._currentFigure = null;
	}
};

// ============================================================================
// Artifact (decorative content - vectors, watermarks, images without alt)
// ============================================================================

AccessibilityTagger.prototype.beginArtifact = function () {
	this._artifactDepth++;
	if (this._artifactDepth === 1) {
		this.doc.markContent('Artifact');
	}
};

AccessibilityTagger.prototype.endArtifact = function () {
	if (this._artifactDepth > 0) {
		this._artifactDepth--;
		if (this._artifactDepth === 0) {
			this.doc.endMarkedContent();
		}
	}
};

// ============================================================================
// Link
// ============================================================================

AccessibilityTagger.prototype.beginLink = function () {
	// Link is a child of the current text element (P, H, LBody)
	var parent = this.currentTextElement;
	if (!parent) {
		// If no text element open, use the current parent container
		parent = this._getCurrentParent();
	}
	if (!parent) { return; }

	this.currentLink = this.doc.struct('Link');
	parent.add(this.currentLink);
};

AccessibilityTagger.prototype.endLink = function () {
	if (this.currentLink) {
		this.currentLink.end();
		this.currentLink = null;
	}
};

// ============================================================================
// High-level line processing
// ============================================================================

/**
 * Process the accessibility context of a line about to be rendered.
 * Opens/closes structure elements as needed based on state transitions.
 *
 * @param {Object} ctx - The _accessibilityContext attached to the line
 * @param {string} ctx.role - Structure role: 'P', 'H1'-'H6', etc.
 * @param {boolean} ctx.isFirstLine - Whether this is the first line of the node
 * @param {boolean} ctx.isLastLine - Whether this is the last line (lastLineInParagraph)
 * @param {Object} [ctx.tableContext] - Table context if inside a tagged table
 * @param {Object} [ctx.listContext] - List context if inside a list
 */
AccessibilityTagger.prototype.processLineContext = function (ctx) {
	if (!ctx) { return; }

	// Handle table context first (opens table/row/cell structures)
	if (ctx.tableContext) {
		this._processTableContext(ctx.tableContext);
	}

	// Handle list context (opens list/item structures)
	if (ctx.listContext) {
		this._processListContext(ctx.listContext);
	}

	// Open the text element (P, H1-H6) if needed
	if (ctx.role && ctx.role !== 'Artifact') {
		this.beginTextElement(ctx.role);
	}
};

/**
 * Handle end-of-structure signals from line context.
 *
 * @param {Object} ctx - The _accessibilityContext
 */
AccessibilityTagger.prototype.processLineEnd = function (ctx) {
	if (!ctx) { return; }

	if (ctx.isLastLine) {
		this._closeTextElement();
	}

	// End list item if it's the last line in this list item
	if (ctx.listContext && ctx.listContext.isLastInItem && ctx.isLastLine) {
		// When the list item ends, close the LBody and LI
		// But don't close the L itself - that happens when endList is called
		this._closeTextElement();
		if (this.currentLBody) {
			this.currentLBody.end();
			this.currentLBody = null;
		}
		if (this.currentListItem) {
			this.currentListItem.end();
			this.currentListItem = null;
		}
	}
};

AccessibilityTagger.prototype._processTableContext = function (tableCtx) {
	// We rely on the layout phase to tell us about row/cell boundaries
	// via the tableContext object on lines
	// Table/THead/TBody/TR/TH/TD opening is handled by the printer
	// via explicit calls (beginTable, beginRow, beginCell, etc.)
};

AccessibilityTagger.prototype._processListContext = function (listCtx) {
	// List structure management is handled by explicit calls
	// (beginList, beginListItem, endListItem, endList) from the layout/printer
};

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Get the current parent element for adding new child structures.
 * Priority order: cell > LBody > Sect
 */
AccessibilityTagger.prototype._getCurrentParent = function () {
	if (this.currentCell) {
		return this.currentCell;
	}
	if (this.currentLBody) {
		return this.currentLBody;
	}
	if (this.currentSect) {
		return this.currentSect;
	}
	return this.documentElement;
};

/**
 * Close all currently open structures (for page transitions etc.)
 */
AccessibilityTagger.prototype._closeAllOpenStructures = function () {
	this._closeTextElement();

	// Close list stack
	while (this.listStack.length > 0 || this.currentList) {
		this.endList();
	}

	// Close table structures
	if (this.currentTable) {
		this.endTable();
	}
};

module.exports = AccessibilityTagger;
