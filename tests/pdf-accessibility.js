'use strict';

var assert = require('assert');
var sinon = require('sinon');

var PdfKitEngine = require('../src/pdfKitEngine');
var Printer = require('../src/printer.js');

var PdfKit = PdfKitEngine.getEngineInstance();

describe('PDF Accessibility', function () {

	var fontDescriptors, printer;
	var structSpy, markContentSpy, endMarkedContentSpy, addStructureSpy;

	beforeEach(function () {
		fontDescriptors = {
			Roboto: {
				normal: 'tests/fonts/Roboto-Regular.ttf'
			}
		};
		structSpy = sinon.spy(PdfKit.prototype, 'struct');
		markContentSpy = sinon.spy(PdfKit.prototype, 'markContent');
		endMarkedContentSpy = sinon.spy(PdfKit.prototype, 'endMarkedContent');
		addStructureSpy = sinon.spy(PdfKit.prototype, 'addStructure');
	});

	afterEach(function () {
		structSpy.restore();
		markContentSpy.restore();
		endMarkedContentSpy.restore();
		addStructureSpy.restore();
	});

	function structTags() {
		var tags = [];
		for (var i = 0; i < structSpy.callCount; i++) {
			tags.push(structSpy.getCall(i).args[0]);
		}
		return tags;
	}

	function markContentTags() {
		var tags = [];
		for (var i = 0; i < markContentSpy.callCount; i++) {
			tags.push(markContentSpy.getCall(i).args[0]);
		}
		return tags;
	}

	var WELLCOME_TABLE_LAYOUT = {
		hLineWidth: function () { return 1; },
		vLineWidth: function () { return 1; },
		hLineColor: function () { return 'black'; },
		vLineColor: function () { return 'black'; },
		paddingLeft: function () { return 4; },
		paddingRight: function () { return 4; },
		paddingTop: function () { return 2; },
		paddingBottom: function () { return 2; }
	};

	it('should create a Document root structure element', function () {
		printer = new Printer(fontDescriptors);
		printer.createPdfKitDocument({ content: [{ text: 'Hello' }] });

		assert.equal(addStructureSpy.callCount, 1);
		var root = addStructureSpy.firstCall.args[0];
		assert.equal(root.dictionary.data.S, 'Document');
	});

	it('should create Sect > H1 and Sect > P structs for heading and paragraph', function () {
		printer = new Printer(fontDescriptors);
		printer.createPdfKitDocument({
			content: [
				{ text: 'Title', nodeName: 'H1' },
				{ text: 'Body text', nodeName: 'P' }
			]
		});

		var tags = structTags();
		assert(tags.indexOf('Document') !== -1, 'should create Document');
		assert(tags.indexOf('Sect') !== -1, 'should create Sect');
		assert(tags.indexOf('H1') !== -1, 'should create H1');
		assert(tags.indexOf('P') !== -1, 'should create P');
	});

	it('should create L > LI > LBody > P structs for lists', function () {
		printer = new Printer(fontDescriptors);
		printer.createPdfKitDocument({
			content: [
				{
					ul: [
						{ text: 'item1', nodeName: 'P' },
						{ text: 'item2', nodeName: 'P' }
					]
				}
			]
		});

		var tags = structTags();
		assert(tags.indexOf('L') !== -1, 'should create L');
		assert(tags.indexOf('LI') !== -1, 'should create LI');
		assert(tags.indexOf('LBody') !== -1, 'should create LBody');

		// Should have 2 LI elements (one per list item)
		var liCount = tags.filter(function (t) { return t === 'LI'; }).length;
		assert.equal(liCount, 2, 'should create one LI per list item');

		var lbodyCount = tags.filter(function (t) { return t === 'LBody'; }).length;
		assert.equal(lbodyCount, 2, 'should create one LBody per list item');
	});

	it('should create Table > THead > TR > TH and TBody > TR > TD structs for accessible tables', function () {
		printer = new Printer(fontDescriptors);
		printer.createPdfKitDocument({
			content: [
				{
					table: {
						headerRows: 1,
						widths: ['*', '*'],
						body: [
							[{ text: 'H1', nodeName: 'P' }, { text: 'H2', nodeName: 'P' }],
							[{ text: 'C1', nodeName: 'P' }, { text: 'C2', nodeName: 'P' }]
						]
					},
					layout: 'wellcomeTableLayout'
				}
			]
		}, {
			tableLayouts: { wellcomeTableLayout: WELLCOME_TABLE_LAYOUT }
		});

		var tags = structTags();
		assert(tags.indexOf('Table') !== -1, 'should create Table');
		assert(tags.indexOf('THead') !== -1, 'should create THead');
		assert(tags.indexOf('TBody') !== -1, 'should create TBody');
		assert(tags.indexOf('TR') !== -1, 'should create TR');
		assert(tags.indexOf('TH') !== -1, 'should create TH');
		assert(tags.indexOf('TD') !== -1, 'should create TD');

		// 2 TR elements: one header row, one body row
		var trCount = tags.filter(function (t) { return t === 'TR'; }).length;
		assert.equal(trCount, 2, 'should create one TR per row');

		// 2 TH + 2 TD
		var thCount = tags.filter(function (t) { return t === 'TH'; }).length;
		var tdCount = tags.filter(function (t) { return t === 'TD'; }).length;
		assert.equal(thCount, 2, 'should create one TH per header cell');
		assert.equal(tdCount, 2, 'should create one TD per body cell');
	});

	it('should not create table struct elements for non-wellcomeTableLayout tables', function () {
		printer = new Printer(fontDescriptors);
		printer.createPdfKitDocument({
			content: [
				{
					table: {
						widths: ['*'],
						body: [
							[{ text: 'Cell', nodeName: 'P' }]
						]
					}
				}
			]
		});

		var tags = structTags();
		assert.equal(tags.indexOf('Table'), -1, 'should not create Table');
		assert.equal(tags.indexOf('TR'), -1, 'should not create TR');
		assert.equal(tags.indexOf('TH'), -1, 'should not create TH');
		assert.equal(tags.indexOf('TD'), -1, 'should not create TD');
	});

	it('should create Figure struct for images with alt text', function () {
		printer = new Printer(fontDescriptors);
		printer.createPdfKitDocument({
			content: [
				{
					image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAGAQMAAADNIO3CAAAAA1BMVEUAAN7GEcIJAAAAAWJLR0QAiAUdSAAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB98DBREbA3IZ3d8AAAALSURBVAjXY2BABwAAEgAB74lUpAAAAABJRU5ErkJggg==',
					alt: 'Test image'
				}
			]
		});

		var tags = structTags();
		assert(tags.indexOf('Figure') !== -1, 'should create Figure');
	});

	it('should render images without alt text as Artifacts', function () {
		printer = new Printer(fontDescriptors);
		printer.createPdfKitDocument({
			content: [
				{
					image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAGAQMAAADNIO3CAAAAA1BMVEUAAN7GEcIJAAAAAWJLR0QAiAUdSAAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB98DBREbA3IZ3d8AAAALSURBVAjXY2BABwAAEgAB74lUpAAAAABJRU5ErkJggg=='
				}
			]
		});

		var tags = structTags();
		assert.equal(tags.indexOf('Figure'), -1, 'should not create Figure for untagged image');
		var mcTags = markContentTags();
		assert(mcTags.indexOf('Artifact') !== -1, 'untagged image should be an Artifact');
	});

	it('should balance markContent and endMarkedContent calls', function () {
		printer = new Printer(fontDescriptors);
		var markStructureContentSpy = sinon.spy(PdfKit.prototype, 'markStructureContent');

		printer.createPdfKitDocument({
			content: [
				{ text: 'Title', nodeName: 'H1' },
				{ text: 'Body', nodeName: 'P' },
				{ ul: [{ text: 'item', nodeName: 'P' }] },
				{
					table: {
						headerRows: 1,
						widths: ['*'],
						body: [
							[{ text: 'Hdr', nodeName: 'P' }],
							[{ text: 'Cell', nodeName: 'P' }]
						]
					},
					layout: 'wellcomeTableLayout'
				},
				{
					image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAGAQMAAADNIO3CAAAAA1BMVEUAAN7GEcIJAAAAAWJLR0QAiAUdSAAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB98DBREbA3IZ3d8AAAALSURBVAjXY2BABwAAEgAB74lUpAAAAABJRU5ErkJggg==',
					alt: 'Photo'
				}
			]
		}, {
			tableLayouts: { wellcomeTableLayout: WELLCOME_TABLE_LAYOUT }
		});

		// markStructureContent internally calls markContent, and PDFKit auto-closes
		// previous structure-content markings when opening a new one. The last
		// structure-content marking on each page stays open (closed by PDFKit at
		// page flush), so the expected surplus equals 1 per page.
		var surplus = markContentSpy.callCount - endMarkedContentSpy.callCount;
		assert.equal(surplus, 1,
			'markContent surplus should be 1 (unclosed final structure-content marking)');

		markStructureContentSpy.restore();
	});

	it('should produce the expected struct sequence for a combined document', function () {
		printer = new Printer(fontDescriptors);
		printer.createPdfKitDocument({
			content: [
				{ text: 'Heading', nodeName: 'H1' },
				{ text: 'Intro', nodeName: 'P' },
				{
					ul: [
						{ text: 'First', nodeName: 'P' },
						{ text: 'Second', nodeName: 'P' }
					]
				},
				{
					table: {
						headerRows: 1,
						widths: ['*', '*'],
						body: [
							[{ text: 'A', nodeName: 'P' }, { text: 'B', nodeName: 'P' }],
							[{ text: 'C', nodeName: 'P' }, { text: 'D', nodeName: 'P' }]
						]
					},
					layout: 'wellcomeTableLayout'
				},
				{
					image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAGAQMAAADNIO3CAAAAA1BMVEUAAN7GEcIJAAAAAWJLR0QAiAUdSAAAAAlwSFlzAAALEwAACxMBAJqcGAAAAAd0SU1FB98DBREbA3IZ3d8AAAALSURBVAjXY2BABwAAEgAB74lUpAAAAABJRU5ErkJggg==',
					alt: 'Decorative'
				}
			]
		}, {
			tableLayouts: { wellcomeTableLayout: WELLCOME_TABLE_LAYOUT }
		});

		var tags = structTags();
		var expected = [
			'Document', 'Sect',
			'H1', 'P',
			'L', 'LI', 'LBody', 'P', 'LI', 'LBody', 'P',
			'Table', 'THead', 'TR', 'TH', 'P', 'TH', 'P',
			'TBody', 'TR', 'TD', 'P', 'TD', 'P',
			'Figure'
		];

		assert.deepEqual(tags, expected,
			'struct sequence should match expected hierarchy');
	});

	it('should mark vectors as Artifacts', function () {
		printer = new Printer(fontDescriptors);
		printer.createPdfKitDocument({
			content: [
				{
					canvas: [{
						type: 'rect',
						x: 0, y: 0, w: 100, h: 50
					}]
				}
			]
		});

		var mcTags = markContentTags();
		assert(mcTags.indexOf('Artifact') !== -1, 'vectors should be marked as Artifact');
	});

	describe('link rendering and annotations', function () {

		var linkSpy;

		beforeEach(function () {
			linkSpy = sinon.spy(PdfKit.prototype, 'link');
		});

		afterEach(function () {
			linkSpy.restore();
		});

		it('should create separate Link structs and annotations for adjacent inlines with different targets', function () {
			printer = new Printer(fontDescriptors);
			printer.createPdfKitDocument({
				content: [
					{
						text: [
							{ text: 'Link A ', link: 'https://a.example.com' },
							{ text: 'Link B', link: 'https://b.example.com' }
						],
						nodeName: 'P'
					}
				]
			});

			var tags = structTags();
			var linkCount = tags.filter(function (t) { return t === 'Link'; }).length;
			assert.equal(linkCount, 2, 'should create one Link struct per distinct target');

			assert.equal(linkSpy.callCount, 2, 'should create one annotation per distinct link target');
			assert.equal(linkSpy.getCall(0).args[4], 'https://a.example.com');
			assert.equal(linkSpy.getCall(1).args[4], 'https://b.example.com');

			// markContent/endMarkedContent surplus should remain 1 (final structure-content marking)
			var surplus = markContentSpy.callCount - endMarkedContentSpy.callCount;
			assert.equal(surplus, 1, 'markContent should be balanced (surplus 1)');
		});

		it('should create one Link struct and annotation for a linked inline sandwiched between non-linked inlines', function () {
			printer = new Printer(fontDescriptors);
			printer.createPdfKitDocument({
				content: [
					{
						text: [
							{ text: 'Before ' },
							{ text: 'Click here', link: 'https://example.com' },
							{ text: ' after' }
						],
						nodeName: 'P'
					}
				]
			});

			var tags = structTags();
			var linkCount = tags.filter(function (t) { return t === 'Link'; }).length;
			assert.equal(linkCount, 1, 'should create exactly one Link struct');

			assert.equal(linkSpy.callCount, 1, 'should create exactly one link annotation');
			assert.equal(linkSpy.getCall(0).args[4], 'https://example.com');

			var surplus = markContentSpy.callCount - endMarkedContentSpy.callCount;
			assert.equal(surplus, 1, 'markContent should be balanced (surplus 1)');
		});

		it('should merge adjacent inlines sharing the same link target into one annotation', function () {
			printer = new Printer(fontDescriptors);
			printer.createPdfKitDocument({
				content: [
					{
						text: [
							{ text: 'Click ', link: 'https://example.com' },
							{ text: 'here', link: 'https://example.com' }
						],
						nodeName: 'P'
					}
				]
			});

			var tags = structTags();
			var linkCount = tags.filter(function (t) { return t === 'Link'; }).length;
			assert.equal(linkCount, 1, 'same-target adjacent inlines should share one Link struct');

			assert.equal(linkSpy.callCount, 1, 'same-target adjacent inlines should produce one annotation');
			assert.equal(linkSpy.getCall(0).args[4], 'https://example.com');
		});

	});

});
