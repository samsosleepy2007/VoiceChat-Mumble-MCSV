/*
 * Copyright (C) 2014 Andrew Comminos
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

package se.lublin.humla.util;

import java.net.MalformedURLException;
import java.net.URLDecoder;
import java.io.UnsupportedEncodingException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import se.lublin.humla.Constants;
import se.lublin.humla.model.Server;

/**
 * An implementation of the Mumble URL scheme.
 * @see <a href="http://mumble.sourceforge.net/Mumble_URL">http://mumble.sourceforge.net/Mumble_URL</a>
 * Created by andrew on 03/03/14.
 */
public class MumbleURLParser {

    private static final Pattern URL_PATTERN = Pattern.compile("mumble://(([^:]+)?(:(.+?))?@)?(.+?)(:([0-9]+?))?/");

    /**
     * Parses the passed Mumble URL into a Server object.
     * @param url A URL with the Mumble scheme.
     * @return A server with the data specified in the Mumble URL.
     * @throws MalformedURLException if the URL cannot be parsed.
     */
    private static String decode(String value) throws MalformedURLException {
        if (value == null) return null;
        try { return URLDecoder.decode(value.replace("+", "%2B"), "UTF-8"); }
        catch (IllegalArgumentException | UnsupportedEncodingException e) { throw new MalformedURLException(); }
    }

    public static Server parseURL(String url) throws MalformedURLException {
        if (url == null) throw new MalformedURLException();
        Matcher matcher = URL_PATTERN.matcher(url);
        if(matcher.matches()) {
            String username = decode(matcher.group(2));
            String password = decode(matcher.group(4));
            String host = matcher.group(5);
            String portString = matcher.group(7);
            int port;
            try { port = portString == null ? Constants.DEFAULT_PORT : Integer.parseInt(portString); }
            catch (NumberFormatException e) { throw new MalformedURLException(); }
            if (port < 1 || port > 65535) throw new MalformedURLException();
            return new Server(-1, null, host, port, username, password);
        } else {
            throw new MalformedURLException();
        }
    }
}
