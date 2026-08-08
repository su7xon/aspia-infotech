<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ChatbotController extends Controller
{
    protected string $ragServiceUrl;

    public function __construct()
    {
        $this->ragServiceUrl = config('services.rag.url', env('RAG_SERVICE_URL', 'http://127.0.0.1:8000'));
    }

    public function ask(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'question' => 'required|string|min:2|max:1000',
            'image' => 'nullable|string',
            'confidence_threshold' => 'nullable|numeric|min:0|max:1',
        ]);

        $question = $validated['question'];
        $image = $validated['image'] ?? null;
        $confidenceThreshold = $validated['confidence_threshold'] ?? null;

        Log::info('Laravel ChatbotController received ask request', [
            'question' => $question,
            'has_image' => !empty($image),
            'user_id' => $request->user()?->id ?? 'guest'
        ]);

        $payload = [
            'question' => $question,
            'image' => $image,
        ];

        if ($confidenceThreshold !== null) {
            $payload['confidence_threshold'] = (float)$confidenceThreshold;
        }

        try {
            $response = Http::timeout(65)
                ->acceptJson()
                ->post("{$this->ragServiceUrl}/ask", $payload);

            if ($response->successful()) {
                $data = $response->json();
                
                return response()->json([
                    'status' => 'success',
                    'data' => [
                        'answer' => $data['answer'] ?? "This isn't covered in our SOPs — please contact the concerned department.",
                        'confidence_score' => $data['confidence_score'] ?? 0.0,
                        'passed_threshold' => $data['passed_threshold'] ?? false,
                        'chunks_retrieved' => $data['chunks_retrieved'] ?? [],
                        'model_used' => $data['model_used'] ?? 'qwen2.5vl',
                    ]
                ], 200);
            }

            Log::error('Python RAG Microservice returned error HTTP code', [
                'status' => $response->status(),
                'body' => $response->body()
            ]);

            return response()->json([
                'status' => 'error',
                'message' => 'The local SOP AI microservice encountered an issue or is currently restarting.',
                'fallback' => "This isn't covered in our SOPs — please contact the concerned department."
            ], 502);

        } catch (\Exception $e) {
            Log::critical('Failed to communicate with Python RAG Service', [
                'error' => $e->getMessage(),
                'target_url' => "{$this->ragServiceUrl}/ask"
            ]);

            return response()->json([
                'status' => 'fallback',
                'data' => [
                    'answer' => "This isn't covered in our SOPs — please contact the concerned department.",
                    'confidence_score' => 0.0,
                    'passed_threshold' => false,
                    'chunks_retrieved' => [],
                    'model_used' => 'offline-fallback'
                ],
                'warning' => 'Local RAG microservice is offline or unreachable.'
            ], 200);
        }
    }

    public function health(): JsonResponse
    {
        try {
            $response = Http::timeout(5)->get("{$this->ragServiceUrl}/health");
            if ($response->successful()) {
                return response()->json([
                    'status' => 'online',
                    'rag_service' => $response->json()
                ]);
            }
        } catch (\Exception $e) {
        }

        return response()->json([
            'status' => 'offline',
            'rag_service_url' => $this->ragServiceUrl,
            'message' => 'RAG microservice is unreachable.'
        ], 503);
    }
}
