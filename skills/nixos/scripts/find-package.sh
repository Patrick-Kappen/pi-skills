#!/usr/bin/env bash
# Usage: find-package.sh [--all] <command | libfoo.so[.N] | header.h | path/in/package>
#
# Prints the nixpkgs attributes that provide a missing command, shared library, header or file,
# best match first, and the command to use the first one. Uses nix-locate (nix-index) with its
# prebuilt database; it does not build or download anything.
#
#   <command>        a program, as in "jq: command not found"        -> searches /bin/<command>
#   libfoo.so.3      a library, as in "error while loading shared libraries: libfoo.so.3"
#                                                                    -> searches /lib/libfoo.so.3
#   zlib.h, a/b.h    a header, as in "fatal error: zlib.h: No such file" -> searches /include/.../zlib.h
#   path/with/slash  any other file in a package                     -> searches that path
#   --all            print every match instead of the first 10
#
# Exit codes: 0 found, 1 nothing found, 2 usage error or nix-locate missing.
set -euo pipefail

limit=10
query=""
for arg in "$@"; do
	case "$arg" in
	--all) limit=0 ;;
	-h | --help)
		sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	-*)
		echo "find-package: unknown option: $arg" >&2
		exit 2
		;;
	*)
		if [[ -n "$query" ]]; then
			echo "find-package: give one command, library, header or path" >&2
			exit 2
		fi
		query="$arg"
		;;
	esac
done
if [[ -z "$query" ]]; then
	echo "usage: find-package.sh [--all] <command | libfoo.so[.N] | header.h | path/in/package>" >&2
	exit 2
fi
if ! command -v nix-locate >/dev/null 2>&1; then
	echo "find-package: nix-locate is missing; run it with: nix run nixpkgs#nix-index -- ... or use 'nix search nixpkgs <name>'" >&2
	exit 2
fi

# Escapes a literal for an extended regular expression.
regex_quote() {
	printf '%s' "$1" | sed 's/[][\.^$*+?(){}|/]/\\&/g'
}

name="${query##*/}"
case "$query" in
*.so | *.so.*)
	kind="library"
	pattern="/lib(64)?/$(regex_quote "$name")$"
	;;
*.h | *.hpp)
	kind="header"
	pattern="/include/(.*/)?$(regex_quote "$query")$"
	;;
*/*)
	kind="file"
	pattern="$(regex_quote "${query#/}")$"
	;;
*)
	kind="command"
	pattern="^/bin/$(regex_quote "$query")$"
	;;
esac

# nix-locate prints "attr.output" per match; "(attr.output)" means only a dependency has the file.
# Patterns match the path inside the package, so ^/bin/jq$ is the program at the package root.
raw="$(nix-locate --minimal --regex "$pattern" 2>/dev/null || true)"

attrs="$(
	printf '%s\n' "$raw" |
		grep -v '^(' |
		sed -E 's/\.(out|bin|dev|lib|man|doc|info|static|debug)$//' |
		awk 'NF' |
		awk '!seen[$0]++'
)"
if [[ -z "$attrs" ]]; then
	echo "find-package: no package provides $kind $query." >&2
	echo "Try: nix search nixpkgs $name, or the name without version (libfoo.so instead of libfoo.so.3)." >&2
	exit 1
fi

# Best first: the attribute named like the query, then top-level attributes with its name in them,
# then other top-level attributes, then nested ones (python3Packages.x); shorter names first.
stem="${name%%.*}"
stem="${stem#lib}"
ranked="$(
	printf '%s\n' "$attrs" | awk -v q="$query" -v stem="$stem" '
		{ rank = 3 }
		$0 == q || $0 == stem { rank = 0 }
		rank == 3 && index($0, ".") == 0 && index($0, stem) > 0 { rank = 1 }
		rank == 3 && index($0, ".") == 0 { rank = 2 }
		{ printf "%d\t%d\t%s\n", rank, length($0), $0 }
	' | sort -s -t $'\t' -k1,1n -k2,2n | cut -f3
)"
if [[ "$limit" -gt 0 ]]; then
	ranked="$(printf '%s\n' "$ranked" | head -n "$limit")"
fi

printf '%s\n' "$ranked"
first="$(printf '%s\n' "$ranked" | head -n 1)"
echo
case "$kind" in
command)
	echo "Run once:        nix shell nixpkgs#$first -c $query ...   (or: , $query ...)"
	;;
*)
	echo "Build with it:   nix shell nixpkgs#$first   (headers and libraries may be in its .dev output)"
	;;
esac
echo "In the devenv:   packages = [ pkgs.$first ];   in devenv.nix"
