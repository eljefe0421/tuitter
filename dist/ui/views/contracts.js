export function isKey(key, ...names) {
    return names.includes(key.name) || names.includes(key.sequence);
}
