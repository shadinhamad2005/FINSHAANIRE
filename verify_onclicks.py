import re

f = open('index.html', encoding='utf-8').read()

onclicks = set(re.findall(r'onclick=[\"\'](.*?)[\"\']', f))
defined_funcs = set(re.findall(r'window\.(\w+)\s*=', f))
defined_funcs.update(['location.reload', 'document.getElementById', 'alert', 'setTimeout', 'console', 'stopPropagation', 'getElementById', 'reload', 'navigator.clipboard.writeText']) 

errors = []
for oc in onclicks:
    funcs = re.findall(r'(?:window\.)?(\w+)\(', oc)
    for func in funcs:
        if func not in defined_funcs:
            errors.append(f"Function {func} is called in onclick='{oc}' but may not be defined in window context!")

print('Errors:')
for e in errors: print(e)
if not errors: print('None found.')
