# scripts/dump-tools.rb — test/fixtures/tools.json: what tools/list returns, for every tool of the registry.
# Run from the API root:
#   TEST_DATABASE=<own test DB> bin/rails runner -e test <cli>/scripts/dump-tools.rb > <cli>/test/fixtures/tools.json
# McpAdapter.mcp_tool(klass).to_h is the same builder tools/list uses (keys already camelCase: inputSchema, readOnlyHint).
tools = AgentTools::Registry.all.map { |klass| AgentTools::McpAdapter.mcp_tool(klass).to_h }
puts JSON.pretty_generate(tools)
