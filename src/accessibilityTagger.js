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

class AccessibilityTagger {
	constructor(pdfKitDoc) {
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

		// BlockQuote grouping tracking
		this.blockQuoteStack = [];
		this.currentBlockQuote = null;

		// Link tracking
		this.currentLink = null;

		// Track what's currently open for page break handling
		this.openStructures = [];

		// Artifact nesting
		this._artifactDepth = 0;

		// Current figure
		this._currentFigure = null;
	}

	/**
	 * Initialise the root Document element and add to the structure tree.
	 */
	initDocument() {
		this.documentElement = this.doc.struct('Document');
		this.doc.addStructure(this.documentElement);
	}

	/**
	 * Finalise the document structure - close all remaining open elements.
	 */
	finalise() {
		this._closeAllOpenStructures();
		if (this.currentSect) {
			this.currentSect.end();
			this.currentSect = null;
		}
		if (this.documentElement) {
			this.documentElement.end();
		}
	}

	// ============================================================================
	// Page (Sect) management
	// ============================================================================

	beginPage() {
		// Close all open structures (tables, lists, text) before ending the Sect,
		// since they are children of the current Sect and must be ended first.
		this._closeAllOpenStructures();

		// Close the previous Sect if one exists
		if (this.currentSect) {
			this.currentSect.end();
			this.currentSect = null;
		}

		// Create a new Sect for this page
		this.currentSect = this.doc.struct('Sect');
		this.documentElement.add(this.currentSect);
	}

	endPage() {
		// End current text element if open
		this._closeTextElement();
	}

	beginNewSection() {
		this._closeAllOpenStructures();

		if (this.currentSect) {
			this.currentSect.end();
		}
		this.currentSect = this.doc.struct('Sect');
		this.documentElement.add(this.currentSect);
	}

	// ============================================================================
	// Text elements (P, H1-H6)
	// ============================================================================

	beginTextElement(role) {
		if (!role || role === 'Artifact') {
			return;
		}

		// If we already have a text element of the same role open, keep it
		if (this.currentTextElement && this.currentTextRole === role) {
			return;
		}

		// Close any existing text element since the role changed
		this._closeTextElement();

		let parent = this._getCurrentParent();
		if (!parent) {
			return;
		}

		this.currentTextRole = role;
		this.currentTextElement = this.doc.struct(role);
		parent.add(this.currentTextElement);
	}

	endTextElement() {
		this._closeTextElement();
	}

	_closeTextElement() {
		if (this.currentLink) {
			this.currentLink.end();
			this.currentLink = null;
		}
		if (this.currentTextElement) {
			this.currentTextElement.end();
			this.currentTextElement = null;
			this.currentTextRole = null;
		}
	}

	// ============================================================================
	// Mark content for the currently open structure element
	// ============================================================================

	/**
	 * Mark content within the currently active structure element.
	 * Returns a function that, when called after content rendering, ends the marked content.
	 *
	 * @param {string} [tag] - Optional override tag for markStructureContent
	 * @returns {Function|null} A cleanup function to call after rendering, or null if no tagging
	 */	markContent(tag) {
		if (this._artifactDepth > 0) {
			return null;
		}

		let activeElement = this.currentLink || this.currentTextElement;
		if (!activeElement) {
			return null;
		}

		let contentTag = tag || this.currentTextRole || 'Span';
		let content = this.doc.markStructureContent(contentTag);
		activeElement.add(content);

		return () => {
			this.doc.endMarkedContent();
		};
	}

	// ============================================================================
	// List structures
	// ============================================================================

	beginList() {
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

		let parent = this._getCurrentParent();
		this.currentList = this.doc.struct('L');
		if (parent) {
			parent.add(this.currentList);
		}
		this.currentListItem = null;
		this.currentLBody = null;
	}

	beginListItem() {
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
	}

	endListItem() {
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

	endList() {
		this._closeTextElement();
		this.endListItem();

		if (this.currentList) {
			this.currentList.end();
		}

		// Pop parent list context
		if (this.listStack.length > 0) {
			let parentCtx = this.listStack.pop();
			this.currentList = parentCtx.listElement;
			this.currentListItem = parentCtx.currentItem;
			this.currentLBody = parentCtx.currentLBody;
		} else {
			this.currentList = null;
			this.currentListItem = null;
			this.currentLBody = null;
		}
	}

	// ============================================================================
	// Table structures
	// ============================================================================

	beginTable(isTOC) {
		this._closeTextElement();
		this.tableIsTOC = isTOC;

		let parent = this._getCurrentParent();
		let tableType = isTOC ? 'TOC' : 'Table';
		this.currentTable = this.doc.struct(tableType);
		if (parent) {
			parent.add(this.currentTable);
		}
	}

	beginTableHeader() {
		if (!this.currentTable) { return; }
		this.currentTHead = this.doc.struct('THead');
		this.currentTable.add(this.currentTHead);
	}

	endTableHeader() {
		if (this.currentTHead) {
			this.currentTHead.end();
			this.currentTHead = null;
		}
	}

	beginTableBody() {
		if (!this.currentTable) { return; }
		this.currentTBody = this.doc.struct('TBody');
		this.currentTable.add(this.currentTBody);
	}

	endTableBody() {
		if (this.currentTBody) {
			this.currentTBody.end();
			this.currentTBody = null;
		}
	}

	beginRow() {
		if (!this.currentTable) { return; }
		let rowType = this.tableIsTOC ? 'TOCI' : 'TR';
		this.currentRow = this.doc.struct(rowType);
		// For TOC, rows go directly under TOC (no THead/TBody)
		let parent = this.tableIsTOC ? this.currentTable : (this.currentTHead || this.currentTBody || this.currentTable);
		parent.add(this.currentRow);
	}

	endRow() {
		this._closeTextElement();

		// Close any open list structures before ending the cell,
		// since cell.end() cascades to children and would leave stale references.
		while (this.currentList) {
			this.endList();
		}

		if (this.currentCell) {
			this.currentCell.end();
			this.currentCell = null;
		}
		if (this.currentRow) {
			this.currentRow.end();
			this.currentRow = null;
		}
	}

	beginCell(isHeader) {
		if (!this.currentRow) { return; }

		this._closeTextElement();

		// Close any open list structures before ending the previous cell,
		// since cell.end() cascades to children and would leave stale references.
		while (this.currentList) {
			this.endList();
		}

		if (this.currentCell) {
			this.currentCell.end();
		}

		// For TOC tables, content sits directly under TOCI (the row element).
		// Don't create a TD/TH child — _getCurrentParent will return currentRow.
		if (this.tableIsTOC) {
			this.currentCell = null;
			return;
		}

		let cellType = isHeader ? 'TH' : 'TD';
		this.currentCell = this.doc.struct(cellType);
		this.currentRow.add(this.currentCell);
	}

	endCell() {
		this._closeTextElement();
		if (this.currentCell) {
			this.currentCell.end();
			this.currentCell = null;
		}
	}

	endTable() {
		this._closeTextElement();
		this.endRow();
		this.endTableHeader();
		this.endTableBody();
		if (this.currentTable) {
			this.currentTable.end();
			this.currentTable = null;
		}
		this.tableIsTOC = false;
	}

	// ============================================================================
	// Figure (images / SVGs with alt text)
	// ============================================================================

	beginFigure(options) {
		let parent = this._getCurrentParent();
		if (!parent) { return; }

		let structOpts = {};
		if (options && options.alt) {
			structOpts.alt = options.alt;
		}
		if (options && options.actualText) {
			structOpts.actual = options.actualText;
		}

		this._currentFigure = this.doc.struct('Figure', structOpts);
		parent.add(this._currentFigure);

		let content = this.doc.markStructureContent('Figure');
		this._currentFigure.add(content);
	}

	endFigure() {
		this.doc.endMarkedContent();
		if (this._currentFigure) {
			this._currentFigure.end();
			this._currentFigure = null;
		}
	}

	// ============================================================================
	// Artifact (decorative content - vectors, watermarks, images without alt)
	// ============================================================================

	beginArtifact() {
		this._artifactDepth++;
		if (this._artifactDepth === 1) {
			this.doc.markContent('Artifact');
		}
	}

	endArtifact() {
		if (this._artifactDepth > 0) {
			this._artifactDepth--;
			if (this._artifactDepth === 0) {
				this.doc.endMarkedContent();
			}
		}
	}

	// ============================================================================
	// BlockQuote grouping
	// ============================================================================

	beginBlockQuote() {
		this._closeTextElement();

		if (this.currentBlockQuote) {
			this.blockQuoteStack.push(this.currentBlockQuote);
		}

		let parent = this._getCurrentParent();
		this.currentBlockQuote = this.doc.struct('BlockQuote');
		if (parent) {
			parent.add(this.currentBlockQuote);
		}
	}

	endBlockQuote() {
		this._closeTextElement();
		if (this.currentBlockQuote) {
			this.currentBlockQuote.end();
		}
		this.currentBlockQuote = this.blockQuoteStack.length > 0 ? this.blockQuoteStack.pop() : null;
	}

	// ============================================================================
	// Link
	// ============================================================================

	beginLink() {
		// Link is a child of the current text element (P, H, LBody)
		let parent = this.currentTextElement;
		if (!parent) {
			// If no text element open, use the current parent container
			parent = this._getCurrentParent();
		}
		if (!parent) { return; }

		this.currentLink = this.doc.struct('Link');
		parent.add(this.currentLink);
	}

	endLink() {
		if (this.currentLink) {
			this.currentLink.end();
			this.currentLink = null;
		}
	}

	// ============================================================================
	// High-level line processing
	// ============================================================================

	/**
	 * Process the accessibility context of a line about to be rendered.
	 * Opens/closes structure elements as needed based on state transitions.
	 *
	 * @param {object} ctx - The _accessibilityContext attached to the line
	 * @param {string} ctx.role - Structure role: 'P', 'H1'-'H6', etc.
	 * @param {boolean} ctx.isFirstLine - Whether this is the first line of the node
	 * @param {boolean} ctx.isLastLine - Whether this is the last line (lastLineInParagraph)
	 * @param {object} [ctx.tableContext] - Table context if inside a tagged table
	 * @param {object} [ctx.listContext] - List context if inside a list
	 */
	processLineContext(ctx) {
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
	}

	/**
	 * Handle end-of-structure signals from line context.
	 *
	 * @param {object} ctx - The _accessibilityContext
	 */
	processLineEnd(ctx) {
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
	}

	_processTableContext() {
		// Table/THead/TBody/TR/TH/TD opening is handled by the renderer
		// via explicit calls (beginTable, beginRow, beginCell, etc.)
	}

	_processListContext() {
		// List structure management is handled by explicit calls
		// (beginList, beginListItem, endListItem, endList) from the layout/renderer
	}

	// ============================================================================
	// Internal helpers
	// ============================================================================

	/**
	 * Get the current parent element for adding new child structures.
	 * Priority order: cell > LBody > Sect
	 *
	 * @returns {object|null} The current PDFKit struct element to use as parent
	 */
	_getCurrentParent() {
		if (this.currentCell) {
			return this.currentCell;
		}
		// For TOC tables, content goes directly under TOCI (the row), not a cell
		if (this.tableIsTOC && this.currentRow) {
			return this.currentRow;
		}
		if (this.currentLBody) {
			return this.currentLBody;
		}
		if (this.currentBlockQuote) {
			return this.currentBlockQuote;
		}
		if (this.currentSect) {
			return this.currentSect;
		}
		return this.documentElement;
	}

	/**
	 * Close all currently open structures (for page transitions etc.)
	 */
	_closeAllOpenStructures() {
		this._closeTextElement();

		// Close list stack
		while (this.listStack.length > 0 || this.currentList) {
			this.endList();
		}

		// Close table structures
		if (this.currentTable) {
			this.endTable();
		}

		// Close any open BlockQuote groupings
		while (this.currentBlockQuote) {
			this.endBlockQuote();
		}
	}
}

export default AccessibilityTagger;
