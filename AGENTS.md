# Documentation Update Process

## Steps to Review and Update Documentation

1. **Read the documentation file completely** to understand what's currently documented

2. **Read the implementation file(s)** to understand the actual API:
   - Read the full class/module implementation
   - Note all public methods, their signatures, parameters, and return types
   - Check default values in constants (e.g., `DEFAULT_RETRY_CONFIG`)
   - Look for TypeScript interfaces/types that define the API contracts
   - Identify all observable properties and their types

3. **Search for real-world usage examples**:
   - Use `grep` to find files using specific methods (e.g., `pool.publish|pool.request`)
   - Use `codebase_search` with semantic queries like "How is the sync method used in examples?"
   - Read multiple example files to see common patterns
   - Note which methods are commonly used together (e.g., `.pipe(toArray())` with `lastValueFrom()`)

4. **Cross-reference types and interfaces**:
   - Read the types file (e.g., `types.ts`) to understand method signatures
   - Check what parameters are required vs optional
   - Verify return types match what's documented

5. **Identify discrepancies** between docs and implementation:
   - Missing methods/properties that exist in the code
   - Incorrect signatures or return types
   - Wrong default values (check constant definitions)
   - Misleading examples that would cause runtime errors
   - Features documented that don't exist in the code

6. **Make corrections systematically**:
   - Fix incorrect information first (wrong types, wrong defaults)
   - Add missing methods/features with practical examples based on real usage
   - Remove documentation for non-existent features
   - Ensure examples match patterns from actual example files

7. **Verify each code example** matches the implementation and would actually work

8. **Run linter** on updated documentation files

9. **Use bd tool** for all work

# Building examples

Never add drop shadows and avoid using cards, the UI looks better when its simple, clean and uses borders.

# Using DaisyUI

THERE IS NO `.form-control` class.
