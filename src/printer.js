/*eslint no-unused-vars: ["error", {"args": "none"}]*/
'use strict';

var PdfKitEngine = require('./pdfKitEngine');
var FontProvider = require('./fontProvider');
var LayoutBuilder = require('./layoutBuilder');
var sizes = require('./standardPageSizes');
var ImageMeasure = require('./imageMeasure');
var SVGMeasure = require('./svgMeasure');
var textDecorator = require('./textDecorator');
var TextTools = require('./textTools');
var isFunction = require('./helpers').isFunction;
var isString = require('./helpers').isString;
var isNumber = require('./helpers').isNumber;
var isBoolean = require('./helpers').isBoolean;
var isArray = require('./helpers').isArray;
var isUndefined = require('./helpers').isUndefined;
var isObject = require('./helpers').isObject;
var isPattern = require('./helpers').isPattern;
var getPattern = require('./helpers').getPattern;
var SVGtoPDF = require('./3rd-party/svg-to-pdfkit');

var findFont = function (fonts, requiredFonts, defaultFont) {
	for (var i = 0; i < requiredFonts.length; i++) {
		var requiredFont = requiredFonts[i].toLowerCase();

		for (var font in fonts) {
			if (font.toLowerCase() === requiredFont) {
				return font;
			}
		}
	}

	return defaultFont;
};

////////////////////////////////////////
// PdfPrinter

/**
 * @class Creates an instance of a PdfPrinter which turns document definition into a pdf
 *
 * @param {Object} fontDescriptors font definition dictionary
 *
 * @example
 * var fontDescriptors = {
 *	Roboto: {
 *		normal: 'fonts/Roboto-Regular.ttf',
 *		bold: 'fonts/Roboto-Medium.ttf',
 *		italics: 'fonts/Roboto-Italic.ttf',
 *		bolditalics: 'fonts/Roboto-MediumItalic.ttf'
 *	}
 * };
 *
 * var printer = new PdfPrinter(fontDescriptors);
 */
function PdfPrinter(fontDescriptors) {
	this.fontDescriptors = fontDescriptors;
}

/**
 * Executes layout engine for the specified document and renders it into a pdfkit document
 * ready to be saved.
 *
 * @param {Object} docDefinition document definition
 * @param {Object} docDefinition.content an array describing the pdf structure (for more information take a look at the examples in the /examples folder)
 * @param {Object} [docDefinition.defaultStyle] default (implicit) style definition
 * @param {Object} [docDefinition.styles] dictionary defining all styles which can be used in the document
 * @param {Object} [docDefinition.pageSize] page size (pdfkit units, A4 dimensions by default)
 * @param {Number} docDefinition.pageSize.width width
 * @param {Number} docDefinition.pageSize.height height
 * @param {Object} [docDefinition.pageMargins] page margins (pdfkit units)
 * @param {Number} docDefinition.maxPagesNumber maximum number of pages to render
 *
 * @example
 *
 * var docDefinition = {
 * 	info: {
 *		title: 'awesome Document',
 *		author: 'john doe',
 *		subject: 'subject of document',
 *		keywords: 'keywords for document',
 * 	},
 *	content: [
 *		'First paragraph',
 *		'Second paragraph, this time a little bit longer',
 *		{ text: 'Third paragraph, slightly bigger font size', fontSize: 20 },
 *		{ text: 'Another paragraph using a named style', style: 'header' },
 *		{ text: ['playing with ', 'inlines' ] },
 *		{ text: ['and ', { text: 'restyling ', bold: true }, 'them'] },
 *	],
 *	styles: {
 *		header: { fontSize: 30, bold: true }
 *	},
 *	patterns: {
 *		stripe45d: {
 *			boundingBox: [1, 1, 4, 4],
 *			xStep: 3,
 *			yStep: 3,
 *			pattern: '1 w 0 1 m 4 5 l s 2 0 m 5 3 l s'
 *		}
 *	}
 * };
 *
 * var pdfKitDoc = printer.createPdfKitDocument(docDefinition);
 *
 * pdfKitDoc.pipe(fs.createWriteStream('sample.pdf'));
 * pdfKitDoc.end();
 *
 * @return {Object} a pdfKit document object which can be saved or encode to data-url
 */
PdfPrinter.prototype.createPdfKitDocument = function (docDefinition, options) {
	options = options || {};

	if (!isObject(docDefinition)) {
		throw new Error("Parameter 'docDefinition' has an invalid type. Object expected.");
	}

	if (!isObject(options)) {
		throw new Error("Parameter 'options' has an invalid type. Object expected.");
	}

	docDefinition.version = docDefinition.version || '1.3';
	docDefinition.subset = docDefinition.subset || undefined;
	docDefinition.tagged = typeof docDefinition.tagged === 'boolean' ? docDefinition.tagged : false;
	docDefinition.displayTitle = typeof docDefinition.displayTitle === 'boolean' ? docDefinition.displayTitle : false;
	docDefinition.compress = isBoolean(docDefinition.compress) ? docDefinition.compress : true;
	docDefinition.images = docDefinition.images || {};
	docDefinition.pageMargins = ((docDefinition.pageMargins !== undefined) && (docDefinition.pageMargins !== null)) ? docDefinition.pageMargins : 40;

	var pageSize = fixPageSize(docDefinition.pageSize, docDefinition.pageOrientation);

	var pdfOptions = {
		size: [pageSize.width, pageSize.height],
		pdfVersion: docDefinition.version,
		subset: docDefinition.subset,
		tagged: docDefinition.tagged,
		displayTitle: docDefinition.displayTitle,
		compress: docDefinition.compress,
		userPassword: docDefinition.userPassword,
		ownerPassword: docDefinition.ownerPassword,
		permissions: docDefinition.permissions,
		lang: docDefinition.language,
		fontLayoutCache: isBoolean(options.fontLayoutCache) ? options.fontLayoutCache : true,
		bufferPages: options.bufferPages || false,
		autoFirstPage: false,
		info: createMetadata(docDefinition),
		font: null
	};

	this.pdfKitDoc = PdfKitEngine.createPdfDocument(pdfOptions);

	this.fontProvider = new FontProvider(this.fontDescriptors, this.pdfKitDoc);

	var builder = new LayoutBuilder(pageSize, fixPageMargins(docDefinition.pageMargins), new ImageMeasure(this.pdfKitDoc, docDefinition.images), new SVGMeasure());

	registerDefaultTableLayouts(builder);
	if (options.tableLayouts) {
		builder.registerTableLayouts(options.tableLayouts);
	}

	var pages = builder.layoutDocument(docDefinition.content, this.fontProvider, docDefinition.styles || {}, docDefinition.defaultStyle || {
		fontSize: 12,
		font: 'Roboto'
	}, docDefinition.background, docDefinition.header, docDefinition.footer, docDefinition.images, docDefinition.watermark, docDefinition.pageBreakBefore);
	var maxNumberPages = docDefinition.maxPagesNumber || -1;
	if (isNumber(maxNumberPages) && maxNumberPages > -1) {
		pages = pages.slice(0, maxNumberPages);
	}

	// if pageSize.height is set to Infinity, calculate the actual height of the page that
	// was laid out using the height of each of the items in the page.
	if (pageSize.height === Infinity) {
		var pageHeight = calculatePageHeight(pages, docDefinition.pageMargins);
		this.pdfKitDoc.options.size = [pageSize.width, pageHeight];
	}

	var patterns = createPatterns(docDefinition.patterns || {}, this.pdfKitDoc);

	renderPages(pages, this.fontProvider, this.pdfKitDoc, patterns, options.progressCallback);

	if (options.autoPrint) {
		var printActionRef = this.pdfKitDoc.ref({
			Type: 'Action',
			S: 'Named',
			N: 'Print'
		});
		this.pdfKitDoc._root.data.OpenAction = printActionRef;
		printActionRef.end();
	}
	return this.pdfKitDoc;
};

function createMetadata(docDefinition) {
	// PDF standard has these properties reserved: Title, Author, Subject, Keywords,
	// Creator, Producer, CreationDate, ModDate, Trapped.
	// To keep the pdfmake api consistent, the info field are defined lowercase.
	// Custom properties don't contain a space.
	function standardizePropertyKey(key) {
		var standardProperties = ['Title', 'Author', 'Subject', 'Keywords',
			'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped'];
		var standardizedKey = key.charAt(0).toUpperCase() + key.slice(1);
		if (standardProperties.indexOf(standardizedKey) !== -1) {
			return standardizedKey;
		}

		return key.replace(/\s+/g, '');
	}

	var info = {
		Producer: 'pdfmake',
		Creator: 'pdfmake'
	};

	if (docDefinition.info) {
		for (var key in docDefinition.info) {
			var value = docDefinition.info[key];
			if (value) {
				key = standardizePropertyKey(key);
				info[key] = value;
			}
		}
	}
	return info;
}

function calculatePageHeight(pages, margins) {
	function getItemHeight(item) {
		if (isFunction(item.item.getHeight)) {
			return item.item.getHeight();
		} else if (item.item._height) {
			return item.item._height;
		} else if (item.type === 'vector') {
			if (typeof item.item.y1 !== 'undefined') {
				return item.item.y1 > item.item.y2 ? item.item.y1 : item.item.y2;
			} else {
				return item.item.h;
			}
		} else {
			// TODO: add support for next item types
			return 0;
		}
	}

	function getBottomPosition(item) {
		var top = item.item.y || 0;
		var height = getItemHeight(item);
		return top + height;
	}

	var fixedMargins = fixPageMargins(margins || 40);
	var height = fixedMargins.top;

	pages.forEach(function (page) {
		page.items.forEach(function (item) {
			var bottomPosition = getBottomPosition(item);
			if (bottomPosition > height) {
				height = bottomPosition;
			}
		});
	});

	height += fixedMargins.bottom;

	return height;
}

function fixPageSize(pageSize, pageOrientation) {
	function isNeedSwapPageSizes(pageOrientation) {
		if (isString(pageOrientation)) {
			pageOrientation = pageOrientation.toLowerCase();
			return ((pageOrientation === 'portrait') && (size.width > size.height)) ||
				((pageOrientation === 'landscape') && (size.width < size.height));
		}
		return false;
	}

	// if pageSize.height is set to auto, set the height to infinity so there are no page breaks.
	if (pageSize && pageSize.height === 'auto') {
		pageSize.height = Infinity;
	}

	var size = pageSize2widthAndHeight(pageSize || 'A4');
	if (isNeedSwapPageSizes(pageOrientation)) { // swap page sizes
		size = { width: size.height, height: size.width };
	}
	size.orientation = size.width > size.height ? 'landscape' : 'portrait';
	return size;
}

function fixPageMargins(margin) {
	if (isNumber(margin)) {
		margin = { left: margin, right: margin, top: margin, bottom: margin };
	} else if (isArray(margin)) {
		if (margin.length === 2) {
			margin = { left: margin[0], top: margin[1], right: margin[0], bottom: margin[1] };
		} else if (margin.length === 4) {
			margin = { left: margin[0], top: margin[1], right: margin[2], bottom: margin[3] };
		} else {
			throw 'Invalid pageMargins definition';
		}
	}

	return margin;
}

function registerDefaultTableLayouts(layoutBuilder) {
	layoutBuilder.registerTableLayouts({
		noBorders: {
			hLineWidth: function (i) {
				return 0;
			},
			vLineWidth: function (i) {
				return 0;
			},
			paddingLeft: function (i) {
				return i && 4 || 0;
			},
			paddingRight: function (i, node) {
				return (i < node.table.widths.length - 1) ? 4 : 0;
			}
		},
		headerLineOnly: {
			hLineWidth: function (i, node) {
				if (i === 0 || i === node.table.body.length) {
					return 0;
				}
				return (i === node.table.headerRows) ? 2 : 0;
			},
			vLineWidth: function (i) {
				return 0;
			},
			paddingLeft: function (i) {
				return i === 0 ? 0 : 8;
			},
			paddingRight: function (i, node) {
				return (i === node.table.widths.length - 1) ? 0 : 8;
			}
		},
		lightHorizontalLines: {
			hLineWidth: function (i, node) {
				if (i === 0 || i === node.table.body.length) {
					return 0;
				}
				return (i === node.table.headerRows) ? 2 : 1;
			},
			vLineWidth: function (i) {
				return 0;
			},
			hLineColor: function (i) {
				return i === 1 ? 'black' : '#aaa';
			},
			paddingLeft: function (i) {
				return i === 0 ? 0 : 8;
			},
			paddingRight: function (i, node) {
				return (i === node.table.widths.length - 1) ? 0 : 8;
			}
		}
	});
}

function pageSize2widthAndHeight(pageSize) {
	if (isString(pageSize)) {
		var size = sizes[pageSize.toUpperCase()];
		if (!size) {
			throw 'Page size ' + pageSize + ' not recognized';
		}
		return { width: size[0], height: size[1] };
	}

	return pageSize;
}

function updatePageOrientationInOptions(currentPage, pdfKitDoc) {
	var previousPageOrientation = pdfKitDoc.options.size[0] > pdfKitDoc.options.size[1] ? 'landscape' : 'portrait';

	if (currentPage.pageSize.orientation !== previousPageOrientation) {
		var width = pdfKitDoc.options.size[0];
		var height = pdfKitDoc.options.size[1];
		pdfKitDoc.options.size = [height, width];
	}
}

function renderPages(pages, fontProvider, pdfKitDoc, patterns, progressCallback) {
	pdfKitDoc._pdfMakePages = pages;
	pdfKitDoc.addPage();

	var permittedBlockElements = ["H", "H1", "H2", "H3", "H4", "H5", "H6", "P"];

	// Initialise document logical structure
	var pdfDocument = pdfKitDoc.struct('Document');
	pdfKitDoc.addStructure(pdfDocument);
	
	var totalItems = 0;
	if (progressCallback) {
		pages.forEach(function (page) {
			totalItems += page.items.length;
		});
	}

	var renderedItems = 0;
	progressCallback = progressCallback || function () {
	};

	var page;
	var pageSection = null;
	var isOpenBlock = false;
	var blockItem = null;
	var blockContent;
	var isInToc = false;
	var tocGroupItem = null;
	var previousStructType = null;

	// Table structure state
	var tableStruct = null;
	var theadStruct = null;
	var tbodyStruct = null;
	var currentTR = null;
	var currentCell = null;
	var currentTableRef = null;
	var currentRowIndex = null;
	var currentColIndex = null;

	// List structure state
	var listStruct = null;
	var currentLI = null;
	var currentLbl = null;
	var currentListRef = null;
	var currentListItemIndex = null;
	var listStack = [];

	function createPageSection(type) {
		pageSection = pdfKitDoc.struct(type);
		pdfDocument.add(pageSection);
	}

	function ensureSect() {
		if (!isInToc && !pageSection) {
			createPageSection('Sect');
		}
	}

	function closeTocGroup() {
		if (tocGroupItem) {
			tocGroupItem.end();
			tocGroupItem = null;
		}
	}

	function closeOpenBlock() {
		if (!isOpenBlock) {
			return;
		}

		pdfKitDoc.endMarkedContent();

		if (blockItem) {
			blockItem.end();
		}

		blockItem = null;
		isOpenBlock = false;

		if (isInToc && tocGroupItem) {
			closeTocGroup();
		}
	}

	function closeTocSection() {
		if (!isInToc) {
			return;
		}

		closeOpenBlock();
		closeList();
		closeTocGroup();

		if (pageSection) {
			pageSection.end();
		}

		pageSection = null;
		isInToc = false;
	}

	// --- List structure helpers ---

	function pushListContext() {
		listStack.push({
			listStruct: listStruct,
			currentLI: currentLI,
			currentLbl: currentLbl,
			currentListRef: currentListRef,
			currentListItemIndex: currentListItemIndex
		});
	}

	function popListContext() {
		var ctx = listStack.pop();
		listStruct = ctx.listStruct;
		currentLI = ctx.currentLI;
		currentLbl = ctx.currentLbl;
		currentListRef = ctx.currentListRef;
		currentListItemIndex = ctx.currentListItemIndex;
	}

	function closeListItem() {
		if (!currentLI) {
			return;
		}
		closeOpenBlock();
		if (currentLbl) {
			currentLbl.end();
			currentLbl = null;
		}
		currentLI.end();
		currentLI = null;
		currentListItemIndex = null;
	}

	function closeList() {
		if (!listStruct) {
			return;
		}
		closeListItem();
		listStruct.end();
		listStruct = null;
		currentListRef = null;
	}

	function closeAllLists() {
		while (listStruct) {
			closeList();
			if (listStack.length > 0) {
				popListContext();
			}
		}
	}

	function openList(listRef) {
		var parent = getContentParent();
		listStruct = pdfKitDoc.struct('L');
		if (isInToc && tocGroupItem) {
			tocGroupItem.add(listStruct);
		} else {
			parent.add(listStruct);
		}
		currentListRef = listRef;
		currentLI = null;
		currentLbl = null;
		currentListItemIndex = null;
	}

	function openListItem(itemIndex) {
		currentLI = pdfKitDoc.struct('LI');
		listStruct.add(currentLI);
		currentLbl = pdfKitDoc.struct('LBody');
		currentLI.add(currentLbl);
		currentListItemIndex = itemIndex;
	}

	// --- Table structure helpers ---

	function closeTableCell() {
		if (!currentCell) {
			return;
		}
		closeOpenBlock();
		closeList();
		currentCell.end();
		currentCell = null;
		currentColIndex = null;
	}

	function closeTableRow() {
		if (!currentTR) {
			return;
		}
		closeTableCell();
		currentTR.end();
		currentTR = null;
		currentRowIndex = null;
	}

	function closeTableHeaderGroup() {
		if (!theadStruct) {
			return;
		}
		closeTableRow();
		theadStruct.end();
		theadStruct = null;
	}

	function closeTableBodyGroup() {
		if (!tbodyStruct) {
			return;
		}
		closeTableRow();
		tbodyStruct.end();
		tbodyStruct = null;
	}

	function closeTable() {
		if (!tableStruct) {
			return;
		}
		closeTableHeaderGroup();
		closeTableBodyGroup();
		tableStruct.end();
		tableStruct = null;
		currentTableRef = null;
		currentRowIndex = null;
		currentColIndex = null;
	}

	function openTable(tableRef) {
		ensureSect();
		tableStruct = pdfKitDoc.struct('Table');
		pageSection.add(tableStruct);
		currentTableRef = tableRef;
	}

	function openTableRow(rowIndex, isHeader) {
		if (isHeader) {
			if (!theadStruct) {
				theadStruct = pdfKitDoc.struct('THead');
				tableStruct.add(theadStruct);
			}
			currentTR = pdfKitDoc.struct('TR');
			theadStruct.add(currentTR);
		} else {
			if (!tbodyStruct) {
				closeTableHeaderGroup();
				tbodyStruct = pdfKitDoc.struct('TBody');
				tableStruct.add(tbodyStruct);
			}
			currentTR = pdfKitDoc.struct('TR');
			tbodyStruct.add(currentTR);
		}
		currentRowIndex = rowIndex;
	}

	function openTableCellElement(colIndex, isHeader) {
		currentCell = pdfKitDoc.struct(isHeader ? 'TH' : 'TD');
		currentTR.add(currentCell);
		currentColIndex = colIndex;
	}

	function getContentParent() {
		if (currentCell) {
			return currentCell;
		}
		if (currentLbl) {
			return currentLbl;
		}
		if (currentLI) {
			return currentLI;
		}
		if (isInToc && tocGroupItem) {
			return tocGroupItem;
		}
		return pageSection;
	}

	function renderFigure(item, renderFn) {
		var hasAltText = item.item && item.item.alt !== undefined && item.item.alt !== null;
		var hasActualText = item.item && item.item.actualText !== undefined && item.item.actualText !== null;
		if (!hasAltText && !hasActualText) {
			pdfKitDoc.markContent('Artifact', { type: "Layout" });
			renderFn(item.item, item.item.x, item.item.y, pdfKitDoc, fontProvider);
			return;
		}

		ensureSect();

		var figureOptions = {};
		if (hasAltText) {
			figureOptions.alt = item.item.alt;
		}
		if (hasActualText) {
			figureOptions.actual = item.item.actualText;
		}

		var figure = pdfKitDoc.struct('Figure', figureOptions);
		var figureGroup = null;
		var parent = getContentParent();

		if (isInToc) {
			figureGroup = pdfKitDoc.struct('TOCI');
			parent.add(figureGroup);
			figureGroup.add(figure);
		} else {
			parent.add(figure);
		}

		blockContent = pdfKitDoc.markStructureContent('Figure');
		figure.add(blockContent);
		pdfKitDoc.markContent('Figure');
		renderFn(item.item, item.item.x, item.item.y, pdfKitDoc, fontProvider);
		pdfKitDoc.endMarkedContent();
		figure.end();

		if (figureGroup) {
			figureGroup.end();
		}
	}

	function deriveLineStructType(item) {
		var node = item.item && item.item._node;
		if (!node) {
			return null;
		}

		return permittedBlockElements.includes(node.nodeName) ? node.nodeName : 'P';
	}

	// Helper to get list annotation from a line or vector item
	function getListAnnotation(item) {
		// Check the item directly (marker lines/vectors carry annotations directly)
		if (item.item && item.item._listRef) {
			return {
				listRef: item.item._listRef,
				listItemIndex: item.item._listItemIndex,
				isMarker: item.item._isListMarker === true
			};
		}
		// Check the _node (content lines carry annotations via the node)
		var node = item.item && item.item._node;
		if (node && node._listRef) {
			return {
				listRef: node._listRef,
				listItemIndex: node._listItemIndex,
				isMarker: false
			};
		}
		return null;
	}

	for (var i = 0; i < pages.length; i++) {
		if (i > 0) {
			updatePageOrientationInOptions(pages[i], pdfKitDoc);
			pdfKitDoc.addPage(pdfKitDoc.options);
		}

		page = pages[i];
		pageSection = null;
		isOpenBlock = false;
		blockItem = null;
		blockContent = undefined;
		isInToc = false;
		tocGroupItem = null;
		previousStructType = null;

		// Table structure state
		tableStruct = null;
		theadStruct = null;
		tbodyStruct = null;
		currentTR = null;
		currentCell = null;
		currentTableRef = null;
		currentRowIndex = null;
		currentColIndex = null;

		// List structure state
		listStruct = null;
		currentLI = null;
		currentLbl = null;
		currentListRef = null;
		currentListItemIndex = null;
		listStack = [];

		for (var ii = 0, il = page.items.length; ii < il; ii++) {
			var item = page.items[ii];
			var itemNodeName = item.item && item.item._node && item.item._node.nodeName;
			var hasPermittedBlockNode = permittedBlockElements.includes(itemNodeName);
			var itemStyles = item.item && item.item._node && item.item._node.style ? item.item._node.style : [];
			var isTocItem = itemStyles.includes('tocItem');

			if (isTocItem && !isInToc) {
				createPageSection('TOC');
				isInToc = true;
			}

			if (!isTocItem && isInToc && hasPermittedBlockNode) {
				closeTocSection();
			}

			// Table structure detection from annotated cell metadata
			var itemNode = item.item && item.item._node ? item.item._node : null;
			var itemTableRef = itemNode && itemNode._tableRef ? itemNode._tableRef : null;
			var itemRowIndex = itemNode && itemNode._tableRowIndex !== undefined ? itemNode._tableRowIndex : null;
			var itemColIndex = itemNode && itemNode._tableColIndex !== undefined ? itemNode._tableColIndex : null;
			var itemIsTableHeader = itemNode ? itemNode._isTableHeader === true : false;
			var itemIsSpanCell = itemNode ? itemNode._span === true : false;

			// Handle table transitions
			if (itemTableRef && !itemIsSpanCell) {
				if (!tableStruct) {
					openTable(itemTableRef);
				} else if (currentTableRef !== itemTableRef) {
					closeTable();
					openTable(itemTableRef);
				}

				// Handle row transitions
				if (itemRowIndex !== null && itemRowIndex !== currentRowIndex) {
					closeTableRow();
					openTableRow(itemRowIndex, itemIsTableHeader);
				}

				// Handle header-to-body group transition within same row group
				if (currentRowIndex === itemRowIndex && theadStruct && !itemIsTableHeader) {
					closeTableHeaderGroup();
					if (!tbodyStruct) {
						tbodyStruct = pdfKitDoc.struct('TBody');
						tableStruct.add(tbodyStruct);
					}
				}

				// Handle cell transitions
				if (itemColIndex !== null && itemColIndex !== currentColIndex) {
					closeTableCell();
					openTableCellElement(itemColIndex, itemIsTableHeader);
				}
			} else if (!itemTableRef && tableStruct && item.type !== 'vector') {
				// Only close the table for non-vector items without table metadata.
				// Vectors (table borders) are interleaved between cell content
				// and should pass through as Artifacts without disrupting table structure.
				closeTable();
			}

			// List structure detection from annotated list metadata
			var listAnnotation = getListAnnotation(item);

			if (listAnnotation) {
				ensureSect();

				// Open or switch list
				if (!listStruct) {
					openList(listAnnotation.listRef);
				} else if (currentListRef !== listAnnotation.listRef) {
					// Different list ref — determine nesting vs returning to parent vs sibling
					if (listAnnotation.listRef._listRef === currentListRef) {
						// Nesting: the new list's parent is the current list.
						// Ensure the correct outer LI is open for the container item.
						var containerItemIndex = listAnnotation.listRef._listItemIndex;
						if (containerItemIndex !== null && containerItemIndex !== currentListItemIndex) {
							closeListItem();
							openListItem(containerItemIndex);
						}
						closeOpenBlock();
						pushListContext();
						openList(listAnnotation.listRef);
					} else {
						// Walk up the stack looking for a parent list that matches
						var found = false;
						while (listStack.length > 0) {
							closeList();
							popListContext();
							if (currentListRef === listAnnotation.listRef) {
								found = true;
								break;
							}
						}
						if (!found) {
							// Completely different list
							closeList();
							openList(listAnnotation.listRef);
						}
					}
				}

				// Open or switch list item
				if (listAnnotation.listItemIndex !== null && listAnnotation.listItemIndex !== currentListItemIndex) {
					closeListItem();
					openListItem(listAnnotation.listItemIndex);
				}

				// Marker items (bullets/numbers) fall through to the switch
				// where vectors become Artifacts and text lines are rendered normally.
			} else if (!listAnnotation && listStruct && item.type !== 'vector') {
				closeAllLists();
			}

			// For items other than lines, mark the content as an Artifact so it's
			// not included in the document structure.
			switch (item.type) {
				case 'vector':
					pdfKitDoc.markContent('Artifact', { type: "Layout" });
					renderVector(item.item, patterns, pdfKitDoc);
					break;
				case 'line':
					{
						var structType = deriveLineStructType(item);
						var hasInlines = Array.isArray(item.item && item.item.inlines) && item.item.inlines.length > 0;
						var hasExplicitLastLineInParagraph = typeof item.item.lastLineInParagraph === 'boolean';

						if (!structType && hasInlines && hasExplicitLastLineInParagraph) {
							structType = previousStructType;
						}

						if (!isInToc && hasPermittedBlockNode) {
							ensureSect();
						}

						// If we don't have an open block, open one now.
						if(!isOpenBlock && structType && pageSection) {
							var parent = getContentParent();

							blockItem = pdfKitDoc.struct(structType);
							if (isInToc) {
								tocGroupItem = pdfKitDoc.struct('TOCI');
								parent.add(tocGroupItem);
								tocGroupItem.add(blockItem);
							} else {
								parent.add(blockItem);
							}
							isOpenBlock = true;
						}

						if (isOpenBlock && structType && blockItem) {
							blockContent = pdfKitDoc.markStructureContent(structType);
							blockItem.add(blockContent);
							pdfKitDoc.markContent(structType);
							renderLine(item.item, item.item.x, item.item.y, patterns, pdfKitDoc, { blockItem: blockItem, structType: structType });
						} else {
							renderLine(item.item, item.item.x, item.item.y, patterns, pdfKitDoc);
						}

						if (structType) {
							previousStructType = structType;
						}

						// If this line is the last in the block, close the block.
						// This allows multiple lines to be grouped into a single block structure.
						if (isOpenBlock && item.item.lastLineInParagraph) {
							closeOpenBlock();
						}
					}
					break;
				case 'image':
					renderFigure(item, function (image, x, y, doc) {
						renderImage(image, x, y, doc);
					});
					break;
				case 'svg':
					renderFigure(item, function (svg, x, y, doc) {
						renderSVG(svg, x, y, doc, fontProvider);
					});
					break;
				case 'beginClip':
					pdfKitDoc.markContent('Artifact', { type: "Layout" });
					beginClip(item.item, pdfKitDoc);
					break;
				case 'endClip':
					pdfKitDoc.markContent('Artifact', { type: "Layout" });
					endClip(pdfKitDoc);
					break;
			}
			renderedItems++;
			progressCallback(renderedItems / totalItems);
		}
		closeOpenBlock();
		closeAllLists();
		closeTocGroup();
		closeTable();
		closeTocSection();
		if (pageSection && !isInToc) {
			pageSection.end();
			pageSection = null;
		}
		if (page.watermark) {
			renderWatermark(page, pdfKitDoc);
		}
		
	}
}

/**
 * Shift the "y" height of the text baseline up or down (superscript or subscript,
 * respectively). The exact shift can / should be changed according to standard
 * conventions.
 *
 * @param {number} y
 * @param {any} inline
 */
function offsetText(y, inline) {
	var newY = y;
	if (inline.sup) {
		newY -= inline.fontSize * 0.75;
	}
	if (inline.sub) {
		newY += inline.fontSize * 0.35;
	}
	return newY;
}

function renderLine(line, x, y, patterns, pdfKitDoc, structContext) {

	function preparePageNodeRefLine(_pageNodeRef, inline) {
		var newWidth;
		var diffWidth;
		var textTools = new TextTools(null);

		if (isUndefined(_pageNodeRef.positions)) {
			throw 'Page reference id not found';
		}

		var pageNumber = _pageNodeRef.positions[0].pageNumber.toString();

		inline.text = pageNumber;
		newWidth = textTools.widthOfString(inline.text, inline.font, inline.fontSize, inline.characterSpacing, inline.fontFeatures);
		diffWidth = inline.width - newWidth;
		inline.width = newWidth;

		switch (inline.alignment) {
			case 'right':
				inline.x += diffWidth;
				break;
			case 'center':
				inline.x += diffWidth / 2;
				break;
		}
	}

	if (line._pageNodeRef) {
		preparePageNodeRefLine(line._pageNodeRef, line.inlines[0]);
	}

	x = x || 0;
	y = y || 0;

	var lineHeight = line.getHeight();
	var ascenderHeight = line.getAscenderHeight();
	var descent = lineHeight - ascenderHeight;

	textDecorator.drawBackground(line, x, y, patterns, pdfKitDoc);

	//TODO: line.optimizeInlines();
	var linkGroups = [];
	var activeLinkStruct = null;
	var activeLinkKey = null;

	for (var i = 0, l = line.inlines.length; i < l; i++) {
		var inline = line.inlines[i];
		var shiftToBaseline = lineHeight - ((inline.font.ascender / 1000) * inline.fontSize) - descent;

		if (inline._pageNodeRef) {
			preparePageNodeRefLine(inline._pageNodeRef, inline);
		}

		// Determine link identity for this inline
		var inlineLink = inline.link || null;
		var inlineGoTo = inline.linkToDestination || null;
		var inlineLinkToPage = inline.linkToPage || null;
		var hasLink = !!(inlineLink || inlineGoTo || inlineLinkToPage);
		var linkKey = hasLink ? (inlineLink || '') + '\0' + (inlineGoTo || '') + '\0' + (inlineLinkToPage || '') : null;

		// Handle Link structure transitions when accessibility tagging is active
		if (structContext && linkKey !== activeLinkKey) {
			// Close previous Link struct if we were in one
			if (activeLinkStruct) {
				pdfKitDoc.endMarkedContent();
				activeLinkStruct.end();
				activeLinkStruct = null;
			}

			if (hasLink) {
				// Entering a linked segment: end parent marking, open Link struct
				pdfKitDoc.endMarkedContent();
				activeLinkStruct = pdfKitDoc.struct('Link');
				structContext.blockItem.add(activeLinkStruct);
				var linkContent = pdfKitDoc.markStructureContent('Link');
				activeLinkStruct.add(linkContent);
				pdfKitDoc.markContent('Link');
			} else if (activeLinkKey !== null) {
				// Returning from a linked segment to non-linked: re-open parent marking
				var parentContent = pdfKitDoc.markStructureContent(structContext.structType);
				structContext.blockItem.add(parentContent);
				pdfKitDoc.markContent(structContext.structType);
			}

			activeLinkKey = linkKey;
		}

		var options = {
			lineBreak: false,
			textWidth: inline.width,
			characterSpacing: inline.characterSpacing,
			wordCount: 1
		};

		if (line.id && i === 0) {
			options.destination = line.id;
		}

		if (inline.fontFeatures) {
			options.features = inline.fontFeatures;
		}

		var opacity = isNumber(inline.opacity) ? inline.opacity : 1;
		pdfKitDoc.opacity(opacity);
		pdfKitDoc.fill(inline.color || 'black');

		pdfKitDoc._font = inline.font;
		pdfKitDoc.fontSize(inline.fontSize);

		var shiftedY = offsetText(y + shiftToBaseline, inline);
		pdfKitDoc.text(`${inline.text}`, x + inline.x, shiftedY, options);

		// Collect link info — adjacent inlines with the same link target
		// are merged into a single group so one annotation spans all of them.
		if (hasLink) {
			var lastGroup = linkGroups.length > 0 ? linkGroups[linkGroups.length - 1] : null;
			if (lastGroup && lastGroup.link === inlineLink && lastGroup.goTo === inlineGoTo && lastGroup.linkToPage === inlineLinkToPage) {
				lastGroup.width = (x + inline.x + inline.width) - lastGroup.x;
			} else {
				linkGroups.push({
					x: x + inline.x,
					y: shiftedY,
					width: inline.width,
					height: inline.height,
					link: inlineLink,
					goTo: inlineGoTo,
					linkToPage: inlineLinkToPage
				});
			}
		}

	}

	// Close any active Link struct and re-open parent marking
	if (structContext && activeLinkStruct) {
		pdfKitDoc.endMarkedContent();
		activeLinkStruct.end();
		activeLinkStruct = null;
		// Re-open parent marking so it remains open for closeOpenBlock
		var parentContent = pdfKitDoc.markStructureContent(structContext.structType);
		structContext.blockItem.add(parentContent);
		pdfKitDoc.markContent(structContext.structType);
	}

	// Create merged link annotations for adjacent inlines sharing the same target.
	for (var gi = 0; gi < linkGroups.length; gi++) {
		var group = linkGroups[gi];
		if (group.link) {
			pdfKitDoc.link(group.x, group.y, group.width, group.height, group.link);
		}
		if (group.goTo) {
			pdfKitDoc.goTo(group.x, group.y, group.width, group.height, group.goTo);
		}
		if (group.linkToPage) {
			pdfKitDoc.ref({ Type: 'Action', S: 'GoTo', D: [group.linkToPage, 0, 0] }).end();
			pdfKitDoc.annotate(group.x, group.y, group.width, group.height, {
				Subtype: 'Link',
				Dest: [group.linkToPage - 1, 'XYZ', null, null, null]
			});
		}
	}

	// Decorations won't draw correctly for superscript
	textDecorator.drawDecorations(line, x, y, pdfKitDoc);
}

function renderWatermark(page, pdfKitDoc) {
	var watermark = page.watermark;

	pdfKitDoc.fill(watermark.color);
	pdfKitDoc.opacity(watermark.opacity);

	pdfKitDoc.save();

	pdfKitDoc.rotate(watermark.angle, { origin: [pdfKitDoc.page.width / 2, pdfKitDoc.page.height / 2] });

	var x = pdfKitDoc.page.width / 2 - watermark._size.size.width / 2;
	var y = pdfKitDoc.page.height / 2 - watermark._size.size.height / 2;

	pdfKitDoc._font = watermark.font;
	pdfKitDoc.fontSize(watermark.fontSize);
	pdfKitDoc.text(watermark.text, x, y, { lineBreak: false });

	pdfKitDoc.restore();
}

function renderVector(vector, patterns, pdfKitDoc) {
	//TODO: pdf optimization (there's no need to write all properties everytime)
	pdfKitDoc.lineWidth(vector.lineWidth || 1);
	if (vector.dash) {
		pdfKitDoc.dash(vector.dash.length, { space: vector.dash.space || vector.dash.length, phase: vector.dash.phase || 0 });
	} else {
		pdfKitDoc.undash();
	}
	pdfKitDoc.lineJoin(vector.lineJoin || 'miter');
	pdfKitDoc.lineCap(vector.lineCap || 'butt');

	//TODO: clipping

	var gradient = null;

	switch (vector.type) {
		case 'ellipse':
			pdfKitDoc.ellipse(vector.x, vector.y, vector.r1, vector.r2);

			if (vector.linearGradient) {
				gradient = pdfKitDoc.linearGradient(vector.x - vector.r1, vector.y, vector.x + vector.r1, vector.y);
			}
			break;
		case 'rect':
			if (vector.r) {
				pdfKitDoc.roundedRect(vector.x, vector.y, vector.w, vector.h, vector.r);
			} else {
				pdfKitDoc.rect(vector.x, vector.y, vector.w, vector.h);
			}

			if (vector.linearGradient) {
				gradient = pdfKitDoc.linearGradient(vector.x, vector.y, vector.x + vector.w, vector.y);
			}
			break;
		case 'line':
			pdfKitDoc.moveTo(vector.x1, vector.y1);
			pdfKitDoc.lineTo(vector.x2, vector.y2);
			break;
		case 'polyline':
			if (vector.points.length === 0) {
				break;
			}

			pdfKitDoc.moveTo(vector.points[0].x, vector.points[0].y);
			for (var i = 1, l = vector.points.length; i < l; i++) {
				pdfKitDoc.lineTo(vector.points[i].x, vector.points[i].y);
			}

			if (vector.points.length > 1) {
				var p1 = vector.points[0];
				var pn = vector.points[vector.points.length - 1];

				if (vector.closePath || p1.x === pn.x && p1.y === pn.y) {
					pdfKitDoc.closePath();
				}
			}
			break;
		case 'path':
			pdfKitDoc.path(vector.d);
			break;
	}

	if (vector.linearGradient && gradient) {
		var step = 1 / (vector.linearGradient.length - 1);

		for (var i = 0; i < vector.linearGradient.length; i++) {
			gradient.stop(i * step, vector.linearGradient[i]);
		}

		vector.color = gradient;
	}

	if (isPattern(vector.color)) {
		vector.color = getPattern(vector.color, patterns);
	}

	var fillOpacity = isNumber(vector.fillOpacity) ? vector.fillOpacity : 1;
	var strokeOpacity = isNumber(vector.strokeOpacity) ? vector.strokeOpacity : 1;

	if (vector.color && vector.lineColor) {
		pdfKitDoc.fillColor(vector.color, fillOpacity);
		pdfKitDoc.strokeColor(vector.lineColor, strokeOpacity);
		pdfKitDoc.fillAndStroke();
	} else if (vector.color) {
		pdfKitDoc.fillColor(vector.color, fillOpacity);
		pdfKitDoc.fill();
	} else {
		pdfKitDoc.strokeColor(vector.lineColor || 'black', strokeOpacity);
		pdfKitDoc.stroke();
	}
}

function renderImage(image, x, y, pdfKitDoc) {
	var opacity = isNumber(image.opacity) ? image.opacity : 1;
	pdfKitDoc.opacity(opacity);
	if (image.cover) {
		var align = image.cover.align || 'center';
		var valign = image.cover.valign || 'center';
		var width = image.cover.width ? image.cover.width : image.width;
		var height = image.cover.height ? image.cover.height : image.height;
		pdfKitDoc.save();
		pdfKitDoc.rect(image.x, image.y, width, height).clip();
		pdfKitDoc.image(image.image, image.x, image.y, { cover: [width, height], align: align, valign: valign });
		pdfKitDoc.restore();
	} else {
		pdfKitDoc.image(image.image, image.x, image.y, { width: image._width, height: image._height });
	}
	if (image.link) {
		pdfKitDoc.link(image.x, image.y, image._width, image._height, image.link);
	}
	if (image.linkToPage) {
		pdfKitDoc.ref({ Type: 'Action', S: 'GoTo', D: [image.linkToPage, 0, 0] }).end();
		pdfKitDoc.annotate(image.x, image.y, image._width, image._height, { Subtype: 'Link', Dest: [image.linkToPage - 1, 'XYZ', null, null, null] });
	}
	if (image.linkToDestination) {
		pdfKitDoc.goTo(image.x, image.y, image._width, image._height, image.linkToDestination);
	}
}

function renderSVG(svg, x, y, pdfKitDoc, fontProvider) {
	var options = Object.assign({ width: svg._width, height: svg._height, assumePt: true, useCSS: !isString(svg.svg) }, svg.options);
	options.fontCallback = function (family, bold, italic) {
		var fontsFamily = family.split(',').map(function (f) { return f.trim().replace(/('|")/g, ''); });
		var font = findFont(fontProvider.fonts, fontsFamily, svg.font || 'Roboto');

		var fontFile = fontProvider.getFontFile(font, bold, italic);
		if (fontFile === null) {
			var type = fontProvider.getFontType(bold, italic);
			throw new Error('Font \'' + font + '\' in style \'' + type + '\' is not defined in the font section of the document definition.');
		}

		return fontFile;
	};

	SVGtoPDF(pdfKitDoc, svg.svg, svg.x, svg.y, options);

	if (svg.link) {
		pdfKitDoc.link(svg.x, svg.y, svg._width, svg._height, svg.link);
	}
	if (svg.linkToPage) {
		pdfKitDoc.ref({Type: 'Action', S: 'GoTo', D: [svg.linkToPage, 0, 0]}).end();
		pdfKitDoc.annotate(svg.x, svg.y, svg._width, svg._height, { Subtype: 'Link', Dest: [svg.linkToPage - 1, 'XYZ', null, null, null] });
	}
	if (svg.linkToDestination) {
		pdfKitDoc.goTo(svg.x, svg.y, svg._width, svg._height, svg.linkToDestination);
	}
}

function beginClip(rect, pdfKitDoc) {
	pdfKitDoc.save();
	pdfKitDoc.addContent('' + rect.x + ' ' + rect.y + ' ' + rect.width + ' ' + rect.height + ' re');
	pdfKitDoc.clip();
}

function endClip(pdfKitDoc) {
	pdfKitDoc.restore();
}

function createPatterns(patternDefinitions, pdfKitDoc) {
	var patterns = {};
	Object.keys(patternDefinitions).forEach(function (p) {
		var pattern = patternDefinitions[p];
		patterns[p] = pdfKitDoc.pattern(pattern.boundingBox, pattern.xStep, pattern.yStep, pattern.pattern, pattern.colored);
	});
	return patterns;
}

module.exports = PdfPrinter;
