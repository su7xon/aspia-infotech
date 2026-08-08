<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\ChatbotController;

Route::prefix('v1')->group(function () {
    Route::post('/chatbot/ask', [ChatbotController::class, 'ask']);
    
    Route::get('/chatbot/health', [ChatbotController::class, 'health']);
});
