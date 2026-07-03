import TextDecorator from './TextDecorator';
import TextInlines from './TextInlines';
import { isNumber, isString } from './helpers/variableType';
import SVGtoPDF from './3rd-party/svg-to-pdfkit';

const findFont = (fonts, requiredFonts, defaultFont) => {
	for (let i = 0; i < requiredFonts.length; i++) {
		let requiredFont = requiredFonts[i].toLowerCase();

		for (let font in fonts) {
			if (font.toLowerCase() === requiredFont) {
				return font;
			}
		}
	}

	return defaultFont;
};

/**
 * Shift the "y" height of the text baseline up or down (superscript or subscript,
 * respectively). The exact shift can / should be changed according to standard
 * conventions.
 *
 * @param {number} y
 * @param {object} inline
 * @returns {number}
 */
const offsetText = (y, inline) => {
	let newY = y;
	if (inline.sup) {
		newY -= inline.fontSize * 0.75;
	}
	if (inline.sub) {
		newY += inline.fontSize * 0.35;
	}
	return newY;
};

class Renderer {
	constructor(pdfDocument, progressCallback) {
		this.pdfDocument = pdfDocument;
		this.progressCallback = progressCallback;
		this.outlineMap = [];
	}

	renderPages(pages, tagger = null) {
		this.pdfDocument._pdfMakePages = pages; // TODO: Why?

		let totalItems = 0;
		if (this.progressCallback) {
			pages.forEach(page => {
				totalItems += page.items.length;
			});
		}

		let renderedItems = 0;

		// Tracks cross-line state for accessibility structure transitions
		const taggerState = tagger ? {
			prevTableContext: null,
			prevListContext: null,
			currentTableHeaderOpen: false,
			currentTableBodyOpen: false,
			_prevRowIndex: -1,
			_prevColIndex: -1,
			prevBlockQuoteDepth: 0
		} : null;

		for (let i = 0; i < pages.length; i++) {
			if (i > 0 && tagger) {
				tagger.endPage();
			}

			this.pdfDocument.addPage({ size: [pages[i].pageSize.width, pages[i].pageSize.height] });

			if (tagger) {
				tagger.beginPage();
				// Reset state for the new page
				taggerState.prevTableContext = null;
				taggerState.prevListContext = null;
				taggerState.currentTableHeaderOpen = false;
				taggerState.currentTableBodyOpen = false;
				taggerState._prevRowIndex = -1;
				taggerState._prevColIndex = -1;
				// beginPage() calls _closeAllOpenStructures() which ends all open BlockQuotes,
				// so reset depth to 0 to keep taggerState in sync.
				taggerState.prevBlockQuoteDepth = 0;
			}

			let page = pages[i];
			for (let ii = 0, il = page.items.length; ii < il; ii++) {
				let item = page.items[ii];
				switch (item.type) {
					case 'vector':
						if (tagger) { tagger.beginArtifact(); }
						this.renderVector(item.item);
						if (tagger) { tagger.endArtifact(); }
						break;
					case 'line':
						this.renderLine(item.item, item.item.x, item.item.y, tagger, taggerState);
						break;
					case 'image':
						this.renderImage(item.item, tagger);
						break;
					case 'svg':
						this.renderSVG(item.item, tagger);
						break;
					case 'attachment':
						this.renderAttachment(item.item);
						break;
					case 'beginClip':
						this.beginClip(item.item);
						break;
					case 'endClip':
						this.endClip();
						break;
					case 'beginVerticalAlignment':
						this.beginVerticalAlignment(item.item);
						break;
					case 'endVerticalAlignment':
						this.endVerticalAlignment(item.item);
						break;
				}
				renderedItems++;
				if (this.progressCallback) {
					this.progressCallback(renderedItems / totalItems);
				}
			}
			if (page.watermark) {
				if (tagger) { tagger.beginArtifact(); }
				this.renderWatermark(page);
				if (tagger) { tagger.endArtifact(); }
			}
		}

		if (tagger) {
			tagger.endPage();
		}
	}

	renderLine(line, x, y, tagger = null, taggerState = null) {
		function preparePageNodeRefLine(_pageNodeRef, inline) {
			let newWidth;
			let diffWidth;
			let textInlines = new TextInlines(null);

			if (_pageNodeRef.positions === undefined) {
				throw new Error('Page reference id not found');
			}

			let pageNumber = _pageNodeRef.positions[0].pageNumber.toString();

			inline.text = pageNumber;
			newWidth = textInlines.widthOfText(inline.text, inline);
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

		if (line._outline) {
			let parentOutline = this.pdfDocument.outline;
			if (line._outline.parentId && this.outlineMap[line._outline.parentId]) {
				parentOutline = this.outlineMap[line._outline.parentId];
			}

			let outline = parentOutline.addItem(line._outline.text, { expanded: line._outline.expanded });
			if (line._outline.id) {
				this.outlineMap[line._outline.id] = outline;
			}
		}

		if (line._pageNodeRef) {
			preparePageNodeRefLine(line._pageNodeRef, line.inlines[0]);
		}

		x = x || 0;
		y = y || 0;

		let lineHeight = line.getHeight();
		let ascenderHeight = line.getAscenderHeight();
		let descent = lineHeight - ascenderHeight;

		const textDecorator = new TextDecorator(this.pdfDocument);

		textDecorator.drawBackground(line, x, y);

		// Accessibility: manage logical structure elements based on this line's context
		if (tagger && line._accessibilityContext) {
			_manageAccessibilityStructures(tagger, taggerState, line._accessibilityContext);
		}

		// Accessibility: open a content mark within the current structure element
		let endContentMark = null;
		if (tagger && line._accessibilityContext && line._accessibilityContext.role !== 'Artifact' && line._accessibilityContext.role !== null) {
			endContentMark = tagger.markContent();
		}

		//TODO: line.optimizeInlines();
		//TODO: lines without differently styled inlines should be written to pdf as one stream
		for (let i = 0, l = line.inlines.length; i < l; i++) {
			let inline = line.inlines[i];
			let shiftToBaseline = lineHeight - ((inline.font.ascender / 1000) * inline.fontSize) - descent;

			if (inline._pageNodeRef) {
				preparePageNodeRefLine(inline._pageNodeRef, inline);
			}

			let options = {
				lineBreak: false,
				textWidth: inline.width,
				characterSpacing: inline.characterSpacing,
				wordCount: 1,
				link: inline.link
			};

			if (inline.linkToDestination) {
				options.goTo = inline.linkToDestination;
			}

			if (line.id && i === 0) {
				options.destination = line.id;
			}

			if (inline.fontFeatures) {
				options.features = inline.fontFeatures;
			}

			// Accessibility: handle inline links — wrap link text in a Link struct
			const hasLink = inline.link || inline.linkToDestination || inline.linkToPage;
			if (tagger && hasLink && endContentMark) {
				endContentMark();
				tagger.beginLink();
				endContentMark = tagger.markContent();
			}

			let opacity = isNumber(inline.opacity) ? inline.opacity : 1;
			this.pdfDocument.opacity(opacity);
			this.pdfDocument.fill(this.pdfDocument.resolveColor(inline.color, 'black'));

			this.pdfDocument._font = inline.font;
			this.pdfDocument.fontSize(inline.fontSize);

			let shiftedY = offsetText(y + shiftToBaseline, inline);
			this.pdfDocument.text(inline.text, x + inline.x, shiftedY, options);

			if (inline.linkToPage) {
				this.pdfDocument.ref({ Type: 'Action', S: 'GoTo', D: [inline.linkToPage, 0, 0] }).end();
				this.pdfDocument.annotate(x + inline.x, shiftedY, inline.width, inline.height, { Subtype: 'Link', Dest: [inline.linkToPage - 1, 'XYZ', null, null, null] });
			}

			// Accessibility: close link marking after link inline
			if (tagger && hasLink) {
				if (endContentMark) { endContentMark(); endContentMark = null; }
				tagger.endLink();
				if (i < l - 1) {
					endContentMark = tagger.markContent();
				}
			}
		}

		// Accessibility: end the content mark for this line
		if (endContentMark) {
			endContentMark();
		}

		// Accessibility: notify tagger that line rendering is complete
		if (tagger && line._accessibilityContext) {
			tagger.processLineEnd(line._accessibilityContext);
		}

		// Decorations won't draw correctly for superscript
		textDecorator.drawDecorations(line, x, y);
	}

	renderVector(vector) {
		//TODO: pdf optimization (there's no need to write all properties everytime)
		this.pdfDocument.lineWidth(vector.lineWidth || 1);
		if (vector.dash) {
			this.pdfDocument.dash(vector.dash.length, { space: vector.dash.space || vector.dash.length, phase: vector.dash.phase || 0 });
		} else {
			this.pdfDocument.undash();
		}
		this.pdfDocument.lineJoin(vector.lineJoin || 'miter');
		this.pdfDocument.lineCap(vector.lineCap || 'butt');

		//TODO: clipping

		let gradient = null;

		switch (vector.type) {
			case 'ellipse':
				this.pdfDocument.ellipse(vector.x, vector.y, vector.r1, vector.r2);

				if (vector.linearGradient) {
					gradient = this.pdfDocument.linearGradient(vector.x - vector.r1, vector.y, vector.x + vector.r1, vector.y);
				}
				break;
			case 'rect':
				if (vector.r) {
					this.pdfDocument.roundedRect(vector.x, vector.y, vector.w, vector.h, vector.r);
				} else {
					this.pdfDocument.rect(vector.x, vector.y, vector.w, vector.h);
				}

				if (vector.linearGradient) {
					gradient = this.pdfDocument.linearGradient(vector.x, vector.y, vector.x + vector.w, vector.y);
				}
				break;
			case 'line':
				this.pdfDocument.moveTo(vector.x1, vector.y1);
				this.pdfDocument.lineTo(vector.x2, vector.y2);
				break;
			case 'polyline':
				if (vector.points.length === 0) {
					break;
				}

				this.pdfDocument.moveTo(vector.points[0].x, vector.points[0].y);
				for (let i = 1, l = vector.points.length; i < l; i++) {
					this.pdfDocument.lineTo(vector.points[i].x, vector.points[i].y);
				}

				if (vector.points.length > 1) {
					let p1 = vector.points[0];
					let pn = vector.points[vector.points.length - 1];

					if (vector.closePath || p1.x === pn.x && p1.y === pn.y) {
						this.pdfDocument.closePath();
					}
				}
				break;
			case 'path':
				this.pdfDocument.path(vector.d);
				break;
		}

		if (vector.linearGradient && gradient) {
			let step = 1 / (vector.linearGradient.length - 1);

			for (let i = 0; i < vector.linearGradient.length; i++) {
				gradient.stop(i * step, vector.linearGradient[i]);
			}

			vector.color = gradient;
		}

		let patternColor = this.pdfDocument.providePattern(vector.color);
		if (patternColor !== null) {
			vector.color = patternColor;
		}

		let fillOpacity = isNumber(vector.fillOpacity) ? vector.fillOpacity : 1;
		let strokeOpacity = isNumber(vector.strokeOpacity) ? vector.strokeOpacity : 1;

		if (vector.color && vector.lineColor) {
			this.pdfDocument.fillColor(this.pdfDocument.resolveColor(vector.color, 'black'), fillOpacity);
			this.pdfDocument.strokeColor(this.pdfDocument.resolveColor(vector.lineColor, 'black'), strokeOpacity);
			this.pdfDocument.fillAndStroke();
		} else if (vector.color) {
			this.pdfDocument.fillColor(this.pdfDocument.resolveColor(vector.color, 'black'), fillOpacity);
			this.pdfDocument.fill();
		} else {
			this.pdfDocument.strokeColor(this.pdfDocument.resolveColor(vector.lineColor, 'black'), strokeOpacity);
			this.pdfDocument.stroke();
		}
	}

	renderImage(image, tagger = null) {
		const isFigure = tagger && image._accessibilityContext && image._accessibilityContext.role === 'Figure';
		if (tagger) {
			if (isFigure) {
				tagger.beginFigure({ alt: image._accessibilityContext.alt, actualText: image._accessibilityContext.actualText });
			} else {
				tagger.beginArtifact();
			}
		}

		let opacity = isNumber(image.opacity) ? image.opacity : 1;
		this.pdfDocument.opacity(opacity);
		if (image.cover) {
			const align = image.cover.align || 'center';
			const valign = image.cover.valign || 'center';
			const width = image.cover.width ? image.cover.width : image.width;
			const height = image.cover.height ? image.cover.height : image.height;
			this.pdfDocument.save();
			this.pdfDocument.rect(image.x, image.y, width, height).clip();
			this.pdfDocument.image(image.image, image.x, image.y, { cover: [width, height], align: align, valign: valign });
			this.pdfDocument.restore();
		} else {
			this.pdfDocument.image(image.image, image.x, image.y, { width: image._width, height: image._height });
		}
		if (image.link) {
			this.pdfDocument.link(image.x, image.y, image._width, image._height, image.link);
		}
		if (image.linkToPage) {
			this.pdfDocument.ref({ Type: 'Action', S: 'GoTo', D: [image.linkToPage, 0, 0] }).end();
			this.pdfDocument.annotate(image.x, image.y, image._width, image._height, { Subtype: 'Link', Dest: [image.linkToPage - 1, 'XYZ', null, null, null] });
		}
		if (image.linkToDestination) {
			this.pdfDocument.goTo(image.x, image.y, image._width, image._height, image.linkToDestination);
		}
		if (image.linkToFile) {
			const attachment = this.pdfDocument.provideAttachment(image.linkToFile);
			this.pdfDocument.fileAnnotation(
				image.x,
				image.y,
				image._width,
				image._height,
				attachment,
				// add empty rectangle as file annotation appearance with the same size as the rendered image
				{
					AP: {
						N: {
							Type: 'XObject',
							Subtype: 'Form',
							FormType: 1,
							BBox: [image.x, image.y, image._width, image._height]
						}
					},
				}
			);
		}

		if (tagger) {
			if (isFigure) {
				tagger.endFigure();
			} else {
				tagger.endArtifact();
			}
		}
	}

	renderSVG(svg, tagger = null) {
		const isFigure = tagger && svg._accessibilityContext && svg._accessibilityContext.role === 'Figure';
		if (tagger) {
			if (isFigure) {
				tagger.beginFigure({ alt: svg._accessibilityContext.alt, actualText: svg._accessibilityContext.actualText });
			} else {
				tagger.beginArtifact();
			}
		}

		let options = {
			width: svg._width,
			height: svg._height,
			assumePt: true,
			useCSS: !isString(svg.svg),
			...svg.options
		};
		options.fontCallback = (family, bold, italic) => {
			let fontsFamily = family.split(',').map(f => f.trim().replace(/('|")/g, ''));
			let font = findFont(this.pdfDocument.fonts, fontsFamily, svg.font || 'Roboto');

			let fontFile = this.pdfDocument.getFontFile(font, bold, italic);
			if (fontFile === null) {
				let type = this.pdfDocument.getFontType(bold, italic);
				throw new Error(`Font '${font}' in style '${type}' is not defined in the font section of the document definition.`);
			}

			return fontFile;
		};

		SVGtoPDF(this.pdfDocument, svg.svg, svg.x, svg.y, options);

		if (svg.link) {
			this.pdfDocument.link(svg.x, svg.y, svg._width, svg._height, svg.link);
		}
		if (svg.linkToPage) {
			this.pdfDocument.ref({ Type: 'Action', S: 'GoTo', D: [svg.linkToPage, 0, 0] }).end();
			this.pdfDocument.annotate(svg.x, svg.y, svg._width, svg._height, { Subtype: 'Link', Dest: [svg.linkToPage - 1, 'XYZ', null, null, null] });
		}
		if (svg.linkToDestination) {
			this.pdfDocument.goTo(svg.x, svg.y, svg._width, svg._height, svg.linkToDestination);
		}

		if (tagger) {
			if (isFigure) {
				tagger.endFigure();
			} else {
				tagger.endArtifact();
			}
		}
	}

	renderAttachment(attachment) {
		const file = this.pdfDocument.provideAttachment(attachment.attachment);

		const options = {};
		if (attachment.icon) {
			options.Name = attachment.icon;
		}

		this.pdfDocument.fileAnnotation(attachment.x, attachment.y, attachment._width, attachment._height, file, options);
	}

	beginClip(rect) {
		this.pdfDocument.save();
		this.pdfDocument.addContent(`${rect.x} ${rect.y} ${rect.width} ${rect.height} re`);
		this.pdfDocument.clip();
	}

	endClip() {
		this.pdfDocument.restore();
	}

	beginVerticalAlignment(item) {
		if (item.isCellContentMultiPage) {
			return;
		}

		switch(item.verticalAlignment) {
			case 'middle':
				this.pdfDocument.save();
				this.pdfDocument.translate(0, -(item.getNodeHeight() - item.getViewHeight()) / 2);
				break;
			case 'bottom':
				this.pdfDocument.save();
				this.pdfDocument.translate(0, -(item.getNodeHeight() - item.getViewHeight()));
				break;
		}
	}

	endVerticalAlignment(item) {
		if (item.isCellContentMultiPage) {
			return;
		}

		switch(item.verticalAlignment) {
			case 'middle':
			case 'bottom':
				this.pdfDocument.restore();
				break;
		}
	}

	renderWatermark(page) {
		let watermark = page.watermark;

		this.pdfDocument.fill(this.pdfDocument.resolveColor(watermark.color, 'black'));
		this.pdfDocument.opacity(watermark.opacity);

		this.pdfDocument.save();

		this.pdfDocument.rotate(watermark.angle, { origin: [this.pdfDocument.page.width / 2, this.pdfDocument.page.height / 2] });

		let x = this.pdfDocument.page.width / 2 - watermark._size.size.width / 2;
		let y = this.pdfDocument.page.height / 2 - watermark._size.size.height / 2;

		this.pdfDocument._font = watermark.font;
		this.pdfDocument.fontSize(watermark.fontSize);
		this.pdfDocument.text(watermark.text, x, y, { lineBreak: false });

		this.pdfDocument.restore();
	}

}

/**
 * Drive the AccessibilityTagger's logical structure based on the current line's context.
 * Called before rendering each line to open/close Table, THead/TBody, TR, TH/TD,
 * List, LI, LBody, and text element (P/H) structures as state transitions dictate.
 *
 * @param {object} tagger - The AccessibilityTagger instance
 * @param {object} state - Cross-line tagger state (prevTableContext, prevListContext, etc.)
 * @param {object} ctx - The _accessibilityContext from the current line
 */
function _manageAccessibilityStructures(tagger, state, ctx) {
	if (!ctx) { return; }

	const prevTC = state.prevTableContext;
	const curTC = ctx.tableContext;
	const prevLC = state.prevListContext;
	const curLC = ctx.listContext;
	const prevBQDepth = state.prevBlockQuoteDepth || 0;
	const curBQDepth = ctx.blockQuoteDepth || 0;

	// ==================== TABLE MANAGEMENT ====================

	const prevInTaggedTable = prevTC && prevTC.tagged;
	const curInTaggedTable = curTC && curTC.tagged;

	if (curInTaggedTable && !prevInTaggedTable) {
		// Entering a tagged table (or re-entering after a page break)
		tagger.beginTable(curTC.isTOC);

		if (!curTC.isTOC) {
			if (curTC.isHeader) {
				tagger.beginTableHeader();
				state.currentTableHeaderOpen = true;
				state.currentTableBodyOpen = false;
			} else {
				tagger.beginTableBody();
				state.currentTableBodyOpen = true;
				state.currentTableHeaderOpen = false;
			}
		}

		tagger.beginRow();
		state._prevRowIndex = curTC.rowIndex;

		if (curTC.colIndex >= 0) {
			tagger.beginCell(curTC.isHeader);
			state._prevColIndex = curTC.colIndex;
		}

	} else if (curInTaggedTable && prevInTaggedTable) {
		// Still inside a tagged table — check for transitions

		// THead → TBody section transition
		if (!curTC.isTOC && prevTC.isHeader && !curTC.isHeader) {
			if (state.currentTableHeaderOpen) {
				tagger.endTableHeader();
				state.currentTableHeaderOpen = false;
			}
			if (!state.currentTableBodyOpen) {
				tagger.beginTableBody();
				state.currentTableBodyOpen = true;
			}
		}

		// Row change
		if (curTC.rowIndex !== state._prevRowIndex) {
			tagger.endRow();
			tagger.beginRow();
			state._prevRowIndex = curTC.rowIndex;
			state._prevColIndex = -1;
		}

		// Column/cell change within the same row
		if (curTC.colIndex >= 0 && curTC.colIndex !== state._prevColIndex) {
			tagger.beginCell(curTC.isHeader);
			state._prevColIndex = curTC.colIndex;
		}

	} else if (!curInTaggedTable && prevInTaggedTable) {
		// Leaving a tagged table
		tagger.endRow();

		if (state.currentTableHeaderOpen) {
			tagger.endTableHeader();
			state.currentTableHeaderOpen = false;
		}
		if (state.currentTableBodyOpen) {
			tagger.endTableBody();
			state.currentTableBodyOpen = false;
		}

		tagger.endTable();
		state._prevRowIndex = -1;
		state._prevColIndex = -1;
	}

	state.prevTableContext = curTC || null;

	// ==================== LIST MANAGEMENT ====================

	if (curLC && !prevLC) {
		// Entering a list for the first time (or re-entering after mid-page close)
		tagger.beginList();
		tagger.beginListItem();
	} else if (curLC && prevLC) {
		if (curLC.depth > prevLC.depth) {
			// Nested list starting
			tagger.beginList();
			tagger.beginListItem();
		} else if (curLC.depth < prevLC.depth) {
			// Returning from nested list(s) — close each inner list level explicitly.
			// Without this, currentList stays as the innermost L element and new items
			// get added to the wrong list in the structure tree.
			for (let d = prevLC.depth; d > curLC.depth; d--) {
				tagger.endList();
			}
			// Now at the correct depth — start a new item if the index changed
			if (curLC.itemIndex !== prevLC.itemIndex) {
				tagger.beginListItem();
			}
		} else if (curLC.itemIndex !== prevLC.itemIndex) {
			// Same depth, new item (previous item was closed by processLineEnd)
			tagger.beginListItem();
		}
	} else if (!curLC && prevLC) {
		// Left all list nesting mid-page — close remaining lists now rather than
		// deferring to the next page-change _closeAllOpenStructures call.
		// This prevents stale L/LI/LBody references from accumulating and being
		// pushed onto the listStack when a subsequent list begins on the same page.
		while (tagger.getListDepth() > 0) {
			tagger.endList();
		}
	}

	state.prevListContext = curLC || null;

	// ==================== BLOCKQUOTE MANAGEMENT ====================

	if (curBQDepth > prevBQDepth) {
		// Entering one or more BlockQuote nesting levels
		for (let i = prevBQDepth; i < curBQDepth; i++) {
			tagger.beginBlockQuote();
		}
	} else if (curBQDepth < prevBQDepth) {
		// Leaving one or more BlockQuote nesting levels
		for (let i = prevBQDepth; i > curBQDepth; i--) {
			tagger.endBlockQuote();
		}
	}

	state.prevBlockQuoteDepth = curBQDepth;

	// ==================== TEXT ELEMENT MANAGEMENT ====================

	if (ctx.role && ctx.role !== 'Artifact') {
		tagger.beginTextElement(ctx.role);
	}
}

export default Renderer;
