// Tiny, synthetic PDF fixtures. The Chinese font is referenced via standard Adobe-GB1 CMaps
// instead of a ToUnicode stream so the test also covers locally bundled character maps.
function fixturePdf(pages) {
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 5 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 760 /StemV 90 >>',
  ];
  const kids = [];
  const hex = s => Buffer.from(s, 'utf16le').swap16().toString('hex');
  for (const lines of pages) {
    const page = objects.length, stream = lines.length ?
      'BT\n/F1 13 Tf\n1 0 0 1 40 785 Tm\n20 TL\n' + lines.map((s, i) => (i ? 'T* ' : '') + '<' + hex(s) + '> Tj').join('\n') + '\nET\n' :
      'q\n1 0 0 rg\n10 10 150 80 re f\nQ\n';
    kids.push(page + ' 0 R');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (page + 1) + ' 0 R >>');
    objects.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
  }
  objects[2] = '<< /Type /Pages /Count ' + kids.length + ' /Kids [' + kids.join(' ') + '] >>';
  let pdf = '%PDF-1.4\n', xref = '0000000000 65535 f \n';
  for (let i = 1; i < objects.length; ++i) {
    xref += String(pdf.length).padStart(10, '0') + ' 00000 n \n';
    pdf += i + ' 0 obj\n' + objects[i] + '\nendobj\n';
  }
  const offset = pdf.length;
  return Buffer.from(pdf + 'xref\n0 ' + objects.length + '\n' + xref + 'trailer\n<< /Size ' + objects.length + ' /Root 1 0 R >>\nstartxref\n' + offset + '\n%%EOF\n', 'ascii');
}
const memoryIntro = '给定一个长度为 n 的整数序列，求每个区间之中不同数的个数。';
const memoryPages = [
  ['D. 记忆（memory）', '【题目描述】', memoryIntro, '【输入格式】', '第一行包含两个正整数。', '【数据范围】', '对于所有测试数据，序列长度不超过十万。'],
  ['【输出格式】', '输出每次询问的结果。', '【样例】', '2 3'],
];
const combinedPages = [
  ['NOIP 模拟赛', '目录', 'A. 方块（square）', 'D. 记忆（memory）', 'E. 路径（path）'],
  ['NOIP 模拟赛', 'A. 方块（square）', '【题目描述】', '给定棋盘和黑白两色方块，求覆盖整个棋盘的最少数量。'],
  ['NOIP 模拟赛', ...memoryPages[0]],
  ['NOIP 模拟赛', ...memoryPages[1], 'E. 路径（path）', '【题目描述】', '给定一棵带有颜色和权值的有根树，输出满足条件的路径数量。'],
];
module.exports = { fixturePdf, memoryIntro, memoryPages, combinedPages };
