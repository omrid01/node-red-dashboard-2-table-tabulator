// Export for CommonJS (Node.js)
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined')
{
	module.exports = {parseFuncSheet,testImport};
}

// Export for Web browser
if (typeof window !== 'undefined') {
  window.tbParseFuncSheet = parseFuncSheet; // fallback for browser without ES6 module support
  window.tbFuncUtils = funcUtils;
  window.tbTestImport = testImport;
}
// cannot use ES6 loading below, as it throws an error in the Node.JS server node
//if (typeof export !== 'undefined' && typeof export.default !== 'undefined') {
//  export default sayHello;
//}

function testImport()
{
	console.log("Hello from export-77");
}

function funcUtils(){}
	// static properties
	funcUtils.pName = '[a-zA-Z_$][a-zA-Z0-9_$]*';  // JS function & param names can only have letters, digits, '$' and '_', and cannot start with a digit
	// regular expressions
	funcUtils.prefix = /^@F:\s*/;  // e.g. @F:myFunctionName, or @F:(a,b)=>{return a+b}
	funcUtils.splitToFuncs = /function\s+/g ; //splits by the keyword 'function' (->the function body must not have another 'function' keyword inside it, not even as a comment)
	funcUtils.matchNamed = /\s*(\S+)\s*\(([^)]*)\)\s*([^]*)/;  // Generic regex with 3 matching groups, to extract name, params & body
	funcUtils.matchUnnamed = /^\(([^)]*)\)\s*=>([^]*)/;  // regex with 2 matching groups, to extract params & body of an inline function
	funcUtils.fName	  = new RegExp('^'+funcUtils.pName+'$'); 
	funcUtils.fParams = new RegExp(`^${funcUtils.pName}\\s*(,\\s*${funcUtils.pName}\\s*)*$|^\\s*$`); // zero or more params, comma-separated
	funcUtils.fBody = /^\{[^]*\}$/;  // checking if enclosed in curly brackets. Unable to check JS syntax validity
	funcUtils.inlineFuncs = /^@F:\s*\([^]*\)\s*=>/;

	// parsing methods
	funcUtils.trimLeadingText = function(str)	{
		return str.replace(/^[\s\S]*?function/,"function");
	}
	funcUtils.trimFuncTail = function(str)	{  //.replace(/([^]*})([^]*)/, '$1') or .replace(/}[\s\S]*$/,'}')
		const index = str.lastIndexOf('}'); // Find the position of the last '}'
        if (index !== -1) // If found, trim the remainder
			return str.substring(0, index + 1);
		else
			return str;
	}

function parseFuncSheet(str)
{
	if (!str)
		return null;

	const funcList = {};

	// first, trim all leading text until the first 'function' keyword
	str = funcUtils.trimLeadingText(str);
	
	//	now, split the sheet into separate function blocks
	const rawFuncs = str.split(funcUtils.splitToFuncs);
	for (let i = 0 ; i < rawFuncs.length ; i++)
	{
		if (rawFuncs[i].trim() !== '')
		{
			const func = funcUtils.trimFuncTail(rawFuncs[i]);  // trim out trailing text (e.g. comments) after the last '}'

			const match = func.match(funcUtils.matchNamed) // extract name, params & body
			if (match !== null)
			{
				const name   = match[1].trim();
				const params = match[2].trim();
				const body   = match[3].trim();

				// test valididty
				if (!funcUtils.fName.test(name))
				{
					console.warn("->Invalid function name:",name);
					continue;
				}
				if (!funcUtils.fParams.test(params))
				{
					console.warn(`->Invalid function params: ${name} (${params})`);
					continue;
				}
				if (!funcUtils.fBody.test(body))
				{
					console.warn(`->Invalid function body: ${name} (${params.replace(/[\s]/g,'')}) ${body}`);
					continue;
				}
				let cleanParams = params.replace(/[\s]/g,'');
				funcList[name] = {
						params: cleanParams ? cleanParams.split(',') : [],
						body: body
					}
			}
			else 
				console.warn("->Invalid function definition: "+func);
		}
    }
    return Object.keys(funcList).length > 0 ? funcList : null;
}
