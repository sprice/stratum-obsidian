/** Shared by all publishing adapters; mirrors Obsidian's mathematical extensions. */
export const publicationMathPreamble = String.raw`
\usepackage{mathtools}
\usepackage{xcolor}
\usepackage[version=4]{mhchem}
\usepackage{cancel}
\usepackage{braket}
\usepackage{amscd}
\usepackage{bussproofs}
\usepackage{centernot}
\usepackage{colortbl}
\usepackage{empheq}
\usepackage{extpfeil}
\usepackage{textcomp}
% STIX already supplies \mathscr; a second script font can exceed legacy TeX's
% 16 symbol-font slots in the CAS class. Keep STIX's native script alphabet.
\makeatletter
\@ifpackageloaded{stix}{%
  \usepackage{upgreek}
  % gensymb allocates an additional symbol font at begin-document. Use the
  % corresponding text symbols inside math to retain STIX's available slots.
  \providecommand{\degree}{\ifmmode\mathord{\text{\textdegree}}\else\textdegree\fi}
  \providecommand{\micro}{\ifmmode\mathord{\text{\textmu}}\else\textmu\fi}
  \providecommand{\ohm}{\ifmmode\mathord{\text{\textohm}}\else\textohm\fi}
  \providecommand{\celsius}{\ifmmode\mathord{\text{\textcelsius}}\else\textcelsius\fi}
  \providecommand{\perthousand}{\ifmmode\mathord{\text{\textperthousand}}\else\textperthousand\fi}
}{%
  \usepackage{gensymb}\usepackage{upgreek}\usepackage{mathrsfs}}
\makeatother
\usepackage{cases}
% amscd's legacy lookahead reads \next, but amsgen's \FN@ can use a different
% token register. AASTeX author parsing leaves \next set and exposes this mismatch.
% Give CD arrows their own lookahead, scoped to the diagram environment.
\makeatletter
\DeclareRobustCommand{\stratumCDarrow}{\futurelet\next\at@}
\AddToHook{env/CD/begin}{\let\Iat\stratumCDarrow}
\makeatother
% MathJax color names follow CSS; several xcolor defaults use different RGB values.
\definecolor{green}{RGB}{0,128,0}
\definecolor{gray}{RGB}{128,128,128}
\definecolor{darkgray}{RGB}{169,169,169}
\definecolor{lightgray}{RGB}{211,211,211}
\definecolor{brown}{RGB}{165,42,42}
\definecolor{lime}{RGB}{0,255,0}
\definecolor{olive}{RGB}{128,128,0}
\definecolor{orange}{RGB}{255,165,0}
\definecolor{pink}{RGB}{255,192,203}
\definecolor{purple}{RGB}{128,0,128}
\definecolor{teal}{RGB}{0,128,128}
\definecolor{violet}{RGB}{238,130,238}
% Pandoc's Unicode math font has bold glyphs without a separate bold font version.
\AtBeginDocument{\ifdefined\symbf\let\boldsymbol\symbf\fi}
% Tooltips have no interaction in print; retain their visible mathematics.
\providecommand{\mathtip}[2]{#1}
\providecommand{\texttip}[2]{#1}
\newcommand{\stratummathbox}[5]{\begingroup
  \setlength{\fboxsep}{#1}\setlength{\fboxrule}{#2}
  \def\stratummathborder{#3}\def\stratummathbackground{#4}
  \mathpalette\stratummathboxcontent{#5}\endgroup}
\newcommand{\stratummathboxcontent}[2]{%
  \fcolorbox{\stratummathborder}{\stratummathbackground}{$\mathsurround=0pt#1#2$}}
`;

/** Display environments already supply their own math delimiters. */
export const publicationMathFilter = String.raw`
local standalone_environments = {
  equation=true, ['equation*']=true, align=true, ['align*']=true,
  alignat=true, ['alignat*']=true, gather=true, ['gather*']=true,
  multline=true, ['multline*']=true, flalign=true, ['flalign*']=true,
  numcases=true, subnumcases=true, prooftree=true, empheq=true
}
local function without_math_comments(text)
  local result, escaped, i = {}, false, 1
  while i <= #text do
    local char = text:sub(i, i)
    if char == '%' and not escaped then
      i = text:find('\n', i, true) or (#text + 1)
      escaped = false
    else
      result[#result + 1] = char
      escaped = char == '\\' and not escaped
      i = i + 1
    end
  end
  return table.concat(result)
end
function Math(el)
  if FORMAT ~= 'latex' or el.mathtype ~= 'DisplayMath' then return nil end
  local code = without_math_comments(el.text)
  local environment = code:match('^%s*\\begin{([%a*]+)}')
  if environment and standalone_environments[environment] then
    local ending = '\\end{' .. environment .. '}'
    if code:gsub('%s+$', ''):sub(-#ending) == ending then
      -- End a trailing comment before Pandoc closes the surrounding span group.
      return pandoc.RawInline('latex', el.text .. '\n')
    end
  end
end
`;

// A MathJax loader directive is never passed to TeX or used to load arbitrary packages.
const supportedExtensions = new Set([
  "base",
  "ams",
  "amscd",
  "autoload",
  "boldsymbol",
  "braket",
  "bussproofs",
  "cancel",
  "cases",
  "centernot",
  "color",
  "colortbl",
  "configmacros",
  "empheq",
  "extpfeil",
  "gensymb",
  "mathtools",
  "mhchem",
  "newcommand",
  "textcomp",
  "textmacros",
  "upgreek",
  "verb",
  "action",
  "bbox",
  "enclose",
]);

// Obsidian's default MathJax configuration numbers only explicitly tagged equations.
const unnumberedEnvironments = new Set([
  "equation",
  "align",
  "alignat",
  "gather",
  "multline",
  "flalign",
]);
const numberedCasesEnvironments = new Set(["numcases", "subnumcases"]);
const enclosureCommands = new Map([
  ["box", "boxed"],
  ["updiagonalstrike", "cancel"],
  ["downdiagonalstrike", "bcancel"],
]);
const unsupportedCommands = new Set([
  "style",
  "class",
  "cssId",
  "data",
  "toggle",
  "endtoggle",
  "unicode",
  "Newextarrow",
  "setOptions",
  "setoptions",
]);

/** Adapt known loader directives, and explain browser-only commands before XeTeX runs. */
export function compatibleMathTex(tex: string, line: number): string {
  const problem = (detail: string): never => {
    throw new Error(
      `An equation near line ${line} ${detail} Use equivalent mathematical notation or embed a vault image of this equation.`,
    );
  };
  let position = 0;
  let braceDepth = 0;
  const environments: { name: string; depth: number }[] = [];
  const whitespace = () => {
    while (/\s/.test(tex[position] ?? "") && position < tex.length) position++;
  };
  const group = (open = "{", close = "}") => {
    whitespace();
    if (tex[position] !== open) problem("has an incomplete MathJax command.");
    const start = ++position;
    let depth = 1;
    while (position < tex.length) {
      const character = tex[position++];
      if (character === "%") {
        while (position < tex.length && tex[position] !== "\n") position++;
        continue;
      }
      if (character === "\\") {
        position++;
        continue;
      }
      if (character === open) depth++;
      if (character === close && --depth === 0)
        return tex.slice(start, position - 1);
    }
    return problem("has an incomplete MathJax command.");
  };
  const dimension = (value: string) => {
    if (!/^\d+(?:\.\d+)?(?:pt|px|em|ex|cm|mm|in)$/.test(value))
      problem("uses a box dimension that PDF publishing does not support yet.");
    return value.endsWith("px")
      ? `${Number(value.slice(0, -2)) * 0.75}bp`
      : value;
  };
  const color = (value: string) => {
    // A common subset of CSS/xcolor names. Never pass CSS or arbitrary TeX through.
    if (
      !/^(?:black|white|red|green|blue|yellow|cyan|magenta|gray|darkgray|lightgray|brown|lime|olive|orange|pink|purple|teal|violet)$/.test(
        value,
      )
    )
      problem(
        `uses the box color “${value}”, which PDF publishing does not support yet.`,
      );
    return value;
  };
  let output = "";
  while (position < tex.length) {
    const start = position;
    if (tex[position] === "%") {
      while (position < tex.length && tex[position] !== "\n") position++;
      output += tex.slice(start, position);
      continue;
    }
    if (tex[position++] !== "\\") {
      if (tex[start] === "{") braceDepth++;
      if (tex[start] === "}") braceDepth--;
      output += tex[start];
      continue;
    }
    const name = /^[a-zA-Z]+|[^]/.exec(tex.slice(position))?.[0] ?? "";
    position += name.length;
    const current = environments.at(-1);
    if (name === "begin" || name === "end") {
      const environment = group();
      if (name === "begin")
        environments.push({ name: environment, depth: braceDepth });
      if (name === "end" && current?.name === environment) {
        if (numberedCasesEnvironments.has(environment)) output += "\\nonumber ";
        environments.pop();
      }
      output += `\\${name}{${unnumberedEnvironments.has(environment) ? environment + "*" : environment}}`;
      if (name === "begin" && environment === "empheq") {
        whitespace();
        if (tex[position] === "[") output += `[${group("[", "]")}]`;
        const inner = group();
        output += `{${unnumberedEnvironments.has(inner) ? inner + "*" : inner}}`;
      }
    } else if (
      name === "\\" &&
      current?.depth === braceDepth &&
      numberedCasesEnvironments.has(current.name)
    ) {
      output += "\\nonumber \\\\";
    } else if (name === "verb") {
      if (tex[position] === "*") position++;
      const delimiter = tex[position++];
      while (position < tex.length && tex[position] !== delimiter) position++;
      if (position < tex.length) position++;
      output += tex.slice(start, position);
    } else if (name === "require") {
      const extension = group().trim();
      if (!supportedExtensions.has(extension))
        problem(
          `requires the MathJax extension “${extension}”, which PDF publishing does not support yet.`,
        );
    } else if (name === "rowcolor") {
      whitespace();
      const model = tex[position] === "[" ? `[${group("[", "]")}]` : "";
      output += `\\rowcolor${model}{${group()}}`;
      whitespace();
      // Some classes change colortbl's default overhang. MathJax fills the
      // intercolumn space, so explicitly cover each half of the array gap.
      if (tex[position] !== "[") output += "[\\arraycolsep][\\arraycolsep]";
    } else if (name === "bbox") {
      whitespace();
      const options = tex[position] === "[" ? group("[", "]") : "";
      let padding = "0pt",
        border = "0pt",
        borderColor = "black",
        background = "white";
      for (const option of options
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)) {
        const edge = /^border:\s*(\S+)\s+solid\s+(\S+)$/.exec(option);
        if (edge) {
          border = dimension(edge[1]);
          borderColor = color(edge[2]);
        } else if (/^\d/.test(option)) padding = dimension(option);
        else background = color(option);
      }
      const body = compatibleMathTex(group(), line);
      output += `\\stratummathbox{${padding}}{${border}}{${borderColor}}{${background}}{${body}}`;
    } else if (name === "enclose") {
      const notation = group()
        .split(",")
        .map((value) => value.trim());
      whitespace();
      if (tex[position] === "[")
        problem(
          "uses \\enclose attributes, which PDF publishing does not support yet.",
        );
      let body = compatibleMathTex(group(), line);
      for (const mark of notation) {
        const command = enclosureCommands.get(mark);
        if (!command)
          problem(
            `uses the \\enclose notation “${mark}”, which PDF publishing does not support yet.`,
          );
        body = `\\${command}{${body}}`;
      }
      output += body;
    } else {
      if (unsupportedCommands.has(name))
        problem(`uses \\${name}, which PDF publishing does not support yet.`);
      output += tex.slice(start, position);
    }
  }
  return output;
}
