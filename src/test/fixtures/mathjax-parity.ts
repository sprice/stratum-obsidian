/** Synthetic equations shared by PDF checks and the Reading-view comparison note. */
export const mathjaxParityExamples = [
  {
    name: "Basic math",
    tex: String.raw`\int_0^1 x^2\,\mathrm{d}x = \frac{1}{3}`,
  },
  { name: "Chemistry", tex: String.raw`\ce{SO4^2- + Ba^2+ -> BaSO4 v}` },
  {
    name: "Cancellation",
    tex: String.raw`\frac{\cancel{x}y}{\cancel{x}} = y \qquad \cancelto{0}{x}`,
  },
  {
    name: "Bra-ket and sets",
    tex: String.raw`\bra{\phi}\ket{\psi} \qquad \Braket{\phi | \psi} \qquad \Set{x | x > 0}`,
  },
  {
    name: "Mathtools",
    tex: String.raw`f(x) \coloneqq \mathclap{x} \qquad A \xleftrightarrow{f} B`,
  },
  {
    name: "Bold symbols",
    tex: String.raw`\boldsymbol{\alpha} + \boldsymbol{\beta}`,
  },
  { name: "Negated relation", tex: String.raw`A \centernot\implies B` },
  {
    name: "Extended arrows",
    tex: String.raw`A \xtwoheadrightarrow{f} B \xmapsto{g} C`,
  },
  {
    name: "Units and upright Greek",
    tex: String.raw`30\degree \qquad 5\micro\mathrm{m} \qquad \upmu + \uppi`,
  },
  { name: "Script letters", tex: String.raw`\mathscr{F}(x)` },
  {
    name: "Colors and arrays",
    tex: String.raw`\begin{array}{cc}\color{red}{a} & b \\ c & \color{blue}{d}\end{array}`,
  },
  {
    name: "Matrix",
    tex: String.raw`\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}`,
  },
  {
    name: "Piecewise function",
    tex: String.raw`f(x)=\begin{cases}x^2 & x \geq 0 \\ -x & x < 0\end{cases}`,
  },
  {
    name: "Commutative diagram",
    tex: String.raw`\begin{CD} A @>f>> B \\ @VgVV @VVhV \\ C @>>k> D \end{CD}`,
  },
  {
    name: "Proof tree",
    tex: String.raw`\begin{prooftree}\AxiomC{$P$}\UnaryInfC{$P$}\end{prooftree}`,
  },
  {
    name: "Aligned display environment",
    tex: String.raw`% A leading TeX comment
\begin{align*}a &= b + c \\ d &= e + f\end{align*}% A trailing TeX comment`,
  },
  {
    name: "Explicit equation reference",
    tex: String.raw`\begin{equation}\tag{P1}\label{stratum-parity-p1}a=b\end{equation}`,
  },
  { name: "Reference", tex: String.raw`\eqref{stratum-parity-p1}` },
  {
    name: "Tooltips",
    tex: String.raw`\mathtip{x^2}{x\times x} + \texttip{y}{a variable}`,
  },
  {
    name: "Local macro",
    tex: String.raw`{\newcommand{\paritysquare}[1]{#1^2}\paritysquare{x}}`,
  },
  {
    name: "Explicit extension",
    tex: String.raw`\require{cancel}\bcancel{x} + \xcancel{y}`,
  },
  {
    name: "Background and border",
    tex: String.raw`\bbox[yellow,2pt,border: 1px solid red]{\frac{x}{y}}`,
  },
  {
    name: "Enclosures",
    tex: String.raw`\enclose{box}{x+1} + \enclose{updiagonalstrike}{y}`,
  },
  {
    name: "Colored rows",
    tex: String.raw`\begin{array}{cc}\rowcolor{yellow}a & b \\ c & d\end{array}`,
  },
  {
    name: "Numbered cases",
    tex: String.raw`\begin{numcases}{f(x)=}x^2 & $x\geq 0$ \\ -x & $x<0$\end{numcases}`,
  },
  {
    name: "Emphasized equations",
    tex: String.raw`\begin{empheq}[left=\empheqlbrace,right=\empheqrbrace]{align}a&=b\\c&=d\end{empheq}`,
  },
];

export const mathjaxParityMarkdown =
  "Inline math: $x^2$, water: $\\ce{H2O}$, and an annotation: $x_{\\bbox[yellow]{i}}$.\n\n" +
  mathjaxParityExamples
    .map(({ name, tex }) => `## ${name}\n\n$$\n${tex}\n$$`)
    .join("\n\n");
