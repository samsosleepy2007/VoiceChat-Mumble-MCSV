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

package se.lublin.humla.test;

import junit.framework.TestCase;

import java.net.MalformedURLException;

import se.lublin.humla.Constants;
import se.lublin.humla.model.Server;
import se.lublin.humla.util.MumbleURLParser;

/**
 * Tests the Mumble URL parser.
 * Created by andrew on 03/03/14.
 */
public class URLParserTest extends TestCase {

    public void testURL() {
        String url = "mumble://server.com/";
        try {
            Server server = MumbleURLParser.parseURL(url);
            assertEquals(server.getHost(), "server.com");
            assertEquals(server.getPort(), Constants.DEFAULT_PORT);
        } catch (MalformedURLException e) {
            fail("Failed to parse URL.");
        }
    }

    public void testURLWithPort() {
        String url = "mumble://server.com:5000/";
        try {
            Server server = MumbleURLParser.parseURL(url);
            assertEquals(server.getHost(), "server.com");
            assertEquals(server.getPort(), 5000);
        } catch (MalformedURLException e) {
            fail("Failed to parse URL.");
        }
    }

    public void testURLWithUsername() {
        String url = "mumble://TestUser@server.com/";
        try {
            Server server = MumbleURLParser.parseURL(url);
            assertEquals(server.getHost(), "server.com");
            assertEquals(server.getUsername(), "TestUser");
            assertEquals(server.getPort(), Constants.DEFAULT_PORT);
        } catch (MalformedURLException e) {
            fail("Failed to parse URL.");
        }
    }

    public void testURLWithCredentials() {
        String url = "mumble://TestUser:mypassword@server.com:5000/";
        try {
            Server server = MumbleURLParser.parseURL(url);
            assertEquals(server.getHost(), "server.com");
            assertEquals(server.getUsername(), "TestUser");
            assertEquals(server.getPassword(), "mypassword");
            assertEquals(server.getPort(), 5000);
        } catch (MalformedURLException e) {
            fail("Failed to parse URL.");
        }
    }

    public void testURLWithPassword() {
        String url = "mumble://:mypassword@server.com/";
        try {
            Server server = MumbleURLParser.parseURL(url);
            assertEquals(server.getHost(), "server.com");
            assertEquals(server.getPassword(), "mypassword");
            assertEquals(server.getPort(), Constants.DEFAULT_PORT);
        } catch (MalformedURLException e) {
            fail("Failed to parse URL.");
        }
    }

    public void testWebJoinWithoutPassword() throws Exception {
        Server server = MumbleURLParser.parseURL("mumble://Sam4014XD@sv7.mcsv.me:18655/");
        assertEquals("Sam4014XD", server.getUsername());
        assertEquals("", server.getPassword());
        assertEquals("sv7.mcsv.me", server.getHost());
        assertEquals(18655, server.getPort());
    }

    public void testWebJoinEncodedXboxName() throws Exception {
        Server server = MumbleURLParser.parseURL("mumble://Sam%20SoSleepy%2B1@sv7.mcsv.me:18655/");
        assertEquals("Sam SoSleepy+1", server.getUsername());
        assertEquals("", server.getPassword());
    }

    public void testEncodedPasswordRemainsIntact() throws Exception {
        Server server = MumbleURLParser.parseURL("mumble://Sam:p%40ss%3Aword%2B1@server.com/");
        assertEquals("p@ss:word+1", server.getPassword());
    }

    public void testURLWithoutCredentialsHasEmptyPassword() throws Exception {
        assertEquals("", MumbleURLParser.parseURL("mumble://server.com/").getPassword());
    }

    public void testInvalidScheme() {
        String url = "grumble://server.com/";
        try {
            MumbleURLParser.parseURL(url);
            fail("Successfully parsed bad scheme!");
        } catch (MalformedURLException e) {
            e.printStackTrace();
        }
    }

}
