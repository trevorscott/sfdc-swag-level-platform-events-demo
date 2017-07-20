'use strict';

// ==============================================
// Load libraries
// ==============================================

var dotenv   = require('dotenv').config();          // necessary if running via 'node app.js' instead of 'heroku local'
var jsforce  = require('jsforce');                  // salesforce client
var express  = require('express');                  // nodejs de-facto web server
var exphbs   = require('express-handlebars');       // for html templating responses
var path     = require('path');                     // utility for parsing and formatting file paths

// ==============================================
// Salesforce OAuth Settings (reusable)
// ==============================================

var sf_oauth2 = new jsforce.OAuth2({
    loginUrl : process.env.OAUTH_SALESFORCE_LOGIN_URL,
    clientId : process.env.OAUTH_SALESFORCE_CLIENT_ID,
    clientSecret : process.env.OAUTH_SALESFORCE_CLIENT_SECRET,
    redirectUri : process.env.OAUTH_SALESFORCE_REDIRECT_URI
});

// ==============================================
// Configure web app to respond to requests
// ==============================================

var app = express();

app.engine( 'handlebars', exphbs( { defaultLayout: 'main' } ) );

app.set( 'view engine', 'handlebars' );
app.set( 'json spaces', 4 ); // pretty print json

// serve up static content from this folder
app.use( express.static( __dirname + '/public' ) );

app.use( function( req, res, next ) {

    // tell browsers not to cache
    // by always setting these headers on responses
    res.set({
        'Cache-Control' : 'private, no-cache, no-store, must-revalidate',
        'Expires' : '-1',
        'Pragma' : 'no-cache'
    });

    next();

});

app.listen( process.env.PORT || 8080 );

// ==============================================
// Endpoints
// ==============================================

app.get( '/', function( req, res ) {

    res.redirect( '/oauth2/auth' );

});

/**
 * Redirects user to oauth authenticate with this connected app.
 */
app.get( '/oauth2/auth', function( req, res ) {

    var authUrl = sf_oauth2.getAuthorizationUrl( { scope : 'api id web refresh_token' } );

    res.redirect( authUrl );

});

/**
 * Receives oauth callback from Salesforce, hopefully, with authorization code.
 */
app.get( '/oauth2/callback', function( req, res ) {

    // in testing, browsers would send a duplicate request after 5 seconds
    // if this redirection did not respond in time.
    // to avoid having a duplicate request we must tell the browser to wait longer
    // https://github.com/expressjs/express/issues/2512
    req.connection.setTimeout( 1000 * 60 * 10 ); // ten minutes

    // initialize salesforce client for making the oauth authorization request
    var sfClient = new jsforce.Connection({
        oauth2 : sf_oauth2,
        version : process.env.SALESFORCE_API_VERSION
    });

    // salesforce oauth authorize request to get access token
    sfClient.authorize( req.query.code, function( err, userInfo ) {

        if ( err ) {

            handleError( err, res );

        } else {

            subscribeToEvents( req, res );

        }

    });

});

app.get( '/subscribe', function( req, res ) {

    // should probably use a session store
    // to keep up with the access token and instance urls
    // per user; for simplicity (and not very secure)
    // just passing around as URL parameters

    res.render( 'subscribe', {
        'accessToken' : req.query.accessToken,
        'instanceUrl' : req.query.instanceUrl,
        'version' : req.query.version || process.env.SALESFORCE_API_VERSION
    });

});

app.get( '/publish', function( req, res ) {

    console.log( 'publishing new event...' );

    var sfClient = new jsforce.Connection({
        instanceUrl : req.query.instanceUrl,
        accessToken : req.query.accessToken,
        version : req.query.version
    });

    sfClient.sobject( 'Swag_Level__e' ).create({

        'Level__c' : 'Low'

    }).then( function( result ) {

        console.log( result );
        res.redirect( '/subscribe?accessToken=' + sfClient.accessToken + '&instanceUrl=' + sfClient.instanceUrl );

    }).catch( function( err ) {

        handleError( err );

    });

});

// ==============================================
// Functions
// ==============================================

function subscribeToEvents( req, res ) {

    console.log( 'subscribing to events...' );

    // http://paulbattisson.com/blog/2017/consuming-platform-events-in-10-lines-of-javascript/
    sfClient.streaming.topic( '/event/Swag_Level__e' ).subscribe( function( message ) {

        console.log( '-- RECEIVED EVENT -----------------------------------------------' );
        console.log( message );
        console.log( '-----------------------------------------------------------------' );

    });

    res.redirect( '/subscribe?accessToken=' + sfClient.accessToken + '&instanceUrl=' + sfClient.instanceUrl );

}

/**
 * Helper function to log error to console then write to response.
 */
function handleError( err, res ) {

    console.error( err );

    res.status( 403 ).send( err );

};