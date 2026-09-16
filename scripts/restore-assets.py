#!/usr/bin/env python3
"""Restore pinned runtime assets; never accept unverified model bytes."""
import argparse
import hashlib
import io
import json
import pathlib
import urllib.request
import zipfile


def valid(data, entry):
    return len(data) == entry['size'] and hashlib.sha256(data).hexdigest() == entry['sha256']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path(__file__).resolve().parents[1])
    parser.add_argument('--check', action='store_true', help='Verify existing assets without downloading')
    args = parser.parse_args()
    entries = json.loads((args.root / 'scripts/assets-manifest.json').read_text())
    downloads = {}
    failures = []
    for entry in entries:
        target = args.root / entry['path']
        if target.is_file() and valid(target.read_bytes(), entry):
            print('OK', entry['path'])
            continue
        if args.check:
            failures.append(entry['path'])
            continue
        try:
            url = entry['url']
            if url not in downloads:
                request = urllib.request.Request(url, headers={'User-Agent': 'RaceWalk-asset-restore/1'})
                with urllib.request.urlopen(request, timeout=120) as response:
                    downloads[url] = response.read()
            data = downloads[url]
            if 'zip_member_suffix' in entry:
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    names = [name for name in archive.namelist() if name.endswith(entry['zip_member_suffix'])]
                    if len(names) != 1:
                        raise ValueError('Archive must contain exactly one matching model')
                    model = archive.read(names[0])
                data = model[entry['offset']:entry['offset'] + entry['size']]
            if not valid(data, entry):
                raise ValueError('Size or SHA-256 mismatch; refusing to install')
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + '.download')
            temporary.write_bytes(data)
            temporary.replace(target)
            print('RESTORED', entry['path'])
        except Exception as error:
            failures.append(entry['path'])
            print('FAILED', entry['path'], str(error))
    if failures:
        raise SystemExit('Missing or invalid assets: ' + ', '.join(failures))
    print(f'All {len(entries)} runtime assets verified.')


if __name__ == '__main__':
    main()
