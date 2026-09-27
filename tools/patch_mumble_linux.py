#!/usr/bin/env python3
from __future__ import annotations

import argparse
import pathlib
import re
import shutil


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"could not locate {label}")
    return text.replace(old, new, 1)


def patch_server_routing(murmur: pathlib.Path) -> None:
    server_cpp = murmur / "Server.cpp"
    text = server_cpp.read_text(encoding="utf-8")

    if '#include "VCProximity.h"' not in text:
        text = replace_once(
            text,
            '#include "Server.h"',
            '#include "Server.h"\n#include "VCProximity.h"',
            "Server.h include",
        )

    if "VC_PROXIMITY_REGULAR_CHANNEL" in text:
        server_cpp.write_text(text, encoding="utf-8")
        return

    start_match = re.search(r"void\s+Server::processMsg\s*\(", text)
    if not start_match:
        raise RuntimeError("could not locate Server::processMsg")
    end_match = re.search(r"\n\s*ZoneNamedN\(", text[start_match.start():])
    if not end_match:
        raise RuntimeError("could not locate processMsg sendout boundary")

    segment_start = start_match.start()
    segment_end = segment_start + end_match.start()
    segment = text[segment_start:segment_end]

    guards = list(re.finditer(r"if\s*\(pDst\)\s*\{", segment))
    if len(guards) != 2:
        raise RuntimeError(f"expected 2 regular listener guards; found {len(guards)}")

    replacements = [
        "if (pDst && VCProximity::shouldRoute(u->qsName, pDst->qsName)) { // VC_PROXIMITY_REGULAR_LISTENER",
        "if (pDst && VCProximity::shouldRoute(u->qsName, pDst->qsName)) { // VC_PROXIMITY_LINKED_LISTENER",
    ]
    pieces = []
    cursor = 0
    for match, replacement in zip(guards, replacements):
        pieces.append(segment[cursor:match.start()])
        pieces.append(replacement)
        cursor = match.end()
    pieces.append(segment[cursor:])
    segment = "".join(pieces)

    listener_adjustment_pattern = re.compile(
        r"m_channelListenerManager\.getListenerVolumeAdjustment\("
        r"(?P<session>pDst->uiSession),\s*(?P<channel>[cl]->iId)\)"
    )
    listener_adjustments = list(listener_adjustment_pattern.finditer(segment))
    if len(listener_adjustments) != 2:
        raise RuntimeError(
            f"expected 2 channel-listener volume adjustments; found {len(listener_adjustments)}"
        )
    segment = listener_adjustment_pattern.sub(
        r"VolumeAdjustment::fromFactor("
        r"m_channelListenerManager.getListenerVolumeAdjustment(\g<session>, \g<channel>).factor * "
        r"VCProximity::attenuationFactor(u->qsName, pDst->qsName))",
        segment,
    )

    normal_pattern = re.compile(
        r"(?P<indent>^[ \t]*)buffer\.addReceiver\(\*u,[ \t]*\*pDst,[ \t]*"
        r"Mumble::Protocol::AudioContext::NORMAL,[ \t]*"
        r"audioData\.containsPositionalData[ \t]*\);",
        re.MULTILINE,
    )
    normals = list(normal_pattern.finditer(segment))
    if len(normals) != 1:
        raise RuntimeError(f"expected 1 same-channel NORMAL receiver; found {len(normals)}")
    match = normals[0]
    indent = match.group("indent")
    original = match.group(0).lstrip(" \t")
    attenuated_original = original[:-2] + (
        ", VolumeAdjustment::fromFactor("
        "VCProximity::attenuationFactor(u->qsName, pDst->qsName)));"
    )
    wrapped = (
        f"{indent}if (VCProximity::shouldRoute(u->qsName, pDst->qsName)) {{ // VC_PROXIMITY_REGULAR_CHANNEL\n"
        f"{indent}\t{attenuated_original} // VC_PROXIMITY_REGULAR_ATTENUATION\n"
        f"{indent}}}"
    )
    segment = segment[:match.start()] + wrapped + segment[match.end():]

    linked_pattern = re.compile(
        r"(?P<indent>^[ \t]*)buffer\.addReceiver\(\*u,\s*\*pDst,\s*"
        r"Mumble::Protocol::AudioContext::NORMAL,\s*\n"
        r"(?P<continuation>[ \t]*)audioData\.containsPositionalData\s*\);",
        re.MULTILINE,
    )
    linked = list(linked_pattern.finditer(segment))
    if len(linked) != 1:
        raise RuntimeError(f"expected 1 linked-channel NORMAL receiver; found {len(linked)}")
    match = linked[0]
    indent = match.group("indent")
    original_lines = match.group(0).lstrip(" \t").splitlines()
    indented_original = ("\n" + indent + "\t").join(original_lines)
    linked_attenuated = indented_original[:-2] + (
        ",\n" + indent + "\t\t\t\t\t\t   VolumeAdjustment::fromFactor("
        "VCProximity::attenuationFactor(u->qsName, pDst->qsName)));"
    )
    wrapped = (
        f"{indent}if (VCProximity::shouldRoute(u->qsName, pDst->qsName)) {{ // VC_PROXIMITY_LINKED_CHANNEL\n"
        f"{indent}\t{linked_attenuated} // VC_PROXIMITY_LINKED_ATTENUATION\n"
        f"{indent}}}"
    )
    segment = segment[:match.start()] + wrapped + segment[match.end():]

    text = text[:segment_start] + segment + text[segment_end:]
    server_cpp.write_text(text, encoding="utf-8")


def patch_gain_trailer(source: pathlib.Path) -> None:
    protocol_cpp = source / "src" / "MumbleProtocol.cpp"
    text = protocol_cpp.read_text(encoding="utf-8")
    if "VC_LEGACY_GAIN_TRAILER" in text:
        return

    old = """\t\tstd::size_t packetSize = data.containsPositionalData ? m_positionalAudioSize : m_staticPartSize;

\t\treturn std::span< byte >(m_byteBuffer.data(), packetSize);
"""
    new = """\t\tstd::size_t packetSize = data.containsPositionalData ? m_positionalAudioSize : m_staticPartSize;

\t\tif constexpr (role == Role::Server) { // VC_LEGACY_GAIN_TRAILER
\t\t\tconst float gain = std::clamp(data.volumeAdjustment.factor, 0.0f, 1.0f);
\t\t\tif (gain < 0.999f && packetSize + 8 <= MAX_UDP_PACKET_SIZE) {
\t\t\t\tm_byteBuffer.resize(packetSize + 8);
\t\t\t\tbyte *trailer = m_byteBuffer.data() + packetSize;
\t\t\t\ttrailer[0] = static_cast< byte >('V');
\t\t\t\ttrailer[1] = static_cast< byte >('C');
\t\t\t\ttrailer[2] = static_cast< byte >('G');
\t\t\t\ttrailer[3] = static_cast< byte >('1');
\t\t\t\tstatic_assert(sizeof(float) == sizeof(std::uint32_t));
\t\t\t\tstd::uint32_t bits = 0;
\t\t\t\tstd::memcpy(&bits, &gain, sizeof(bits));
\t\t\t\ttrailer[4] = static_cast< byte >(bits & 0xffu);
\t\t\t\ttrailer[5] = static_cast< byte >((bits >> 8u) & 0xffu);
\t\t\t\ttrailer[6] = static_cast< byte >((bits >> 16u) & 0xffu);
\t\t\t\ttrailer[7] = static_cast< byte >((bits >> 24u) & 0xffu);
\t\t\t\tpacketSize += 8;
\t\t\t}
\t\t}

\t\treturn std::span< byte >(m_byteBuffer.data(), packetSize);
"""
    text = replace_once(text, old, new, "legacy audio packet return block")
    if "#include <cstdint>" not in text:
        text = text.replace("#include <cstring>\n", "#include <cstring>\n#include <cstdint>\n", 1)
    protocol_cpp.write_text(text, encoding="utf-8")


def patch_cmake(murmur: pathlib.Path) -> None:
    cmake = murmur / "CMakeLists.txt"
    text = cmake.read_text(encoding="utf-8")
    if "VCStateFeed.cpp" not in text:
        text = replace_once(
            text,
            '\t"Server.cpp"\n\t"Server.h"\n',
            '\t"Server.cpp"\n\t"Server.h"\n\t"VCProximity.cpp"\n\t"VCProximity.h"\n\t"VCStateFeed.cpp"\n\t"VCStateFeed.h"\n',
            "murmur source list",
        )
    text = text.replace(
        "find_pkg(Qt6 COMPONENTS Sql REQUIRED)",
        "find_pkg(Qt6 COMPONENTS Sql Network REQUIRED)",
        1,
    )
    text = text.replace(
        "target_link_libraries(mumble_server_object_lib PUBLIC shared Qt6::Sql)",
        "target_link_libraries(mumble_server_object_lib PUBLIC shared Qt6::Sql Qt6::Network)",
        1,
    )
    cmake.write_text(text, encoding="utf-8")


def patch_main(murmur: pathlib.Path) -> None:
    path = murmur / "main.cpp"
    text = path.read_text(encoding="utf-8")
    if '#include "VCStateFeed.h"' not in text:
        text = replace_once(
            text,
            '#include "ServerApplication.h"',
            '#include "ServerApplication.h"\n#include "VCStateFeed.h"',
            "ServerApplication include",
        )
    if "VC_PROXIMITY_STATE_FEED" not in text:
        text = replace_once(
            text,
            "\t\tmeta->bootAll(Meta::getConnectionParameter(), true);",
            "\t\tmeta->bootAll(Meta::getConnectionParameter(), true);\n\n"
            "\t\tVCStateFeed vcStateFeed; // VC_PROXIMITY_STATE_FEED\n"
            "\t\tif (!vcStateFeed.start(47855)) {\n"
            "\t\t\tqFatal(\"VC proximity state feed could not bind localhost UDP 47855\");\n"
            "\t\t}",
            "meta bootAll",
        )
    path.write_text(text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--patch-dir", required=True)
    args = parser.parse_args()

    source = pathlib.Path(args.source).resolve()
    patch_dir = pathlib.Path(args.patch_dir).resolve()
    murmur = source / "src" / "murmur"

    for name in ("VCProximity.cpp", "VCProximity.h", "VCStateFeed.cpp", "VCStateFeed.h"):
        shutil.copyfile(patch_dir / name, murmur / name)

    patch_server_routing(murmur)
    patch_gain_trailer(source)
    patch_cmake(murmur)
    patch_main(murmur)

    checks = {
        "route": "VC_PROXIMITY_REGULAR_CHANNEL" in (murmur / "Server.cpp").read_text(),
        "gain": "VC_LEGACY_GAIN_TRAILER" in (source / "src" / "MumbleProtocol.cpp").read_text(),
        "feed": "VC_PROXIMITY_STATE_FEED" in (murmur / "main.cpp").read_text(),
    }
    if not all(checks.values()):
        raise RuntimeError(f"patch verification failed: {checks}")
    print(checks)


if __name__ == "__main__":
    main()
